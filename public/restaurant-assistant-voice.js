// Realtime browser conversation. Audio stays in WebRTC; text and order UI share the assistant panel.
const start = document.querySelector('#start-voice');
const stop = null; // Single start/stop toggle uses #start-voice.
const status = document.querySelector('#voice-status');
const audio = document.querySelector('#assistant-audio');
const consent = document.querySelector('#record-consent');
const record = document.querySelector('#start-recording');
const stopRecord = document.querySelector('#stop-recording');
const download = document.querySelector('#recording-download');
const voiceHolder = start?.closest('[data-voice-url]');
let call;
let recordingUrl;
function setOrbState() { /* Legacy orb removed: connection state is shown in voice-status. */ }
function updateRecordingControls() {
  if (!record) return;
  const connected = call?.peer?.connectionState === 'connected';
  const recording = call?.recorder?.state === 'recording';
  record.disabled = !connected || !call?.remote || !consent.checked || recording;
  stopRecord.disabled = !recording;
}
function stopRecording(current) {
  if (current?.recorder?.state === 'recording') current.recorder.stop();
}
function finish(message = 'Voice ended.') {
  const current = call;
  call = undefined;
  if (current?.connectionTimeout) clearTimeout(current.connectionTimeout);
  if (current?.finishTimer) clearTimeout(current.finishTimer);
  current?.controller.abort();
  stopRecording(current);
  current?.peer.close();
  current?.mic?.getTracks().forEach(track => track.stop());
  if (!current?.recorder) current?.context?.close().catch(() => {});
  audio.pause(); audio.srcObject = null; audio.hidden = true;
  start.disabled = false; start.setAttribute('aria-label','Start live conversation'); start.title='Start live conversation'; start.setAttribute('aria-pressed','false');
  status.textContent = message;
  setOrbState('off');
  updateRecordingControls();
}
function sendRealtime(current, event) {
  if (call !== current || current.events?.readyState !== 'open') return false;
  current.events.send(JSON.stringify(event));
  return true;
}
function waitForIceGathering(peer, signal, maxMs = 5000) {
  if (peer.iceGatheringState === 'complete' || signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      peer.removeEventListener('icegatheringstatechange', check);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const check = () => { if (peer.iceGatheringState === 'complete') done(); };
    const timeout = setTimeout(done, maxMs);
    peer.addEventListener('icegatheringstatechange', check);
    signal.addEventListener('abort', done, { once: true });
    check();
  });
}
function voiceFailure(code, reason) {
  if (reason === 'quota_unavailable') return 'Voice API quota is unavailable. Use text chat.';
  if (reason === 'invalid_credentials' || reason === 'permission_denied') return 'Voice provider access needs configuration.';
  if (reason === 'model_unavailable') return 'Voice model unavailable for this project.';
  if (reason === 'rate_limited' || code === 429) return 'Too many voice requests. Please retry later.';
  if (code === 503) return 'Voice service temporarily unavailable.';
  return 'Could not connect voice. Please retry.';
}
function updateMessage(current, role, itemId, text, append = false) {
  if (call !== current || typeof text !== 'string' || !text.trim()) return;
  window.MarKhoorAssistant?.upsertVoiceMessage(role, itemId, text, append);
}
function explicitYes(text) {
  if (typeof text !== 'string') return false;
  const clean = text.normalize('NFKC').trim().toLowerCase().replace(/[.!?,"'।]+$/gu, '').trim();
  if (/\b(no|not|don't|dont|cancel|nahi|nahin|mat karo|stop|change|modify)\b/i.test(clean) || /(?:नहीं|नही|मत|रद्द|बदल)/u.test(clean)) return false;
  return /^(?:yes|yeah|yep|haan|han|ji|confirm|confirmed|ok|okay|theek hai|bilkul|go ahead|kar do|kardo|place order|submit order)(?:\b|$)/i.test(clean) ||
    /(?:\b(?:confirm|confirmed|place|submit|kardo|kar do|haan|han|yes|bilkul)\b|(?:हाँ|हां|जी|पक्का|कन्फर्म|कर दो|भेज दो|ठीक है)|(?:ہاں|جی|کنفرم|کر دو|ٹھیک ہے))/iu.test(clean);
}
async function verifiedMenu(current) {
  if (current.menu) return current.menu;
  const response = await fetch(voiceHolder.dataset.menuUrl, {cache:'no-store',signal:current.controller.signal});
  if (!response.ok) throw Error('Menu unavailable');
  const data = await response.json();
  if (!Array.isArray(data.items)) throw Error('Menu unavailable');
  current.menu = data;
  return data;
}
async function prepareOrder(current, args) {
  const menu = await verifiedMenu(current);
  const name = typeof args.customer_name === 'string' ? args.customer_name.trim() : '';
  if (!name || name.length > 160 || !Array.isArray(args.items) ||
      args.items.length < 1 || args.items.length > 30) throw Error('Ask for the customer name and valid menu items');
  const menuById = new Map(menu.items.map(item => [Number(item.id),item]));
  const quantities = new Map();
  for (const item of args.items) {
    if (!Number.isSafeInteger(item?.menu_item_id) || !Number.isSafeInteger(item?.quantity) ||
        item.quantity < 1 || item.quantity > 99 || !menuById.has(item.menu_item_id)) throw Error('Invalid menu selection');
    const count = (quantities.get(item.menu_item_id) || 0) + item.quantity;
    if (count > 99) throw Error('Quantity limit exceeded');
    quantities.set(item.menu_item_id, count);
  }
  let total = 0;
  const items = [...quantities].map(([id,quantity]) => {
    const item = menuById.get(id);
    total += Number(item.price_minor) * quantity;
    return {menu_item_id:id,quantity,name:item.name,unit_price_minor:Number(item.price_minor)};
  });
  if (!Number.isSafeInteger(total) || total > 1000000000) throw Error('Order amount invalid');
  current.draft = {customer_name:name,items:items.map(({menu_item_id,quantity})=>({menu_item_id,quantity})),total_minor:total};
  // Repeated identical drafts must not erase a confirmation already given.
  const signature = JSON.stringify(current.draft);
  if (signature !== current.draftSignature) current.confirmedSinceDraft = false;
  current.draftSignature = signature;
  current.draftAt = Date.now();
  const money = new Intl.NumberFormat(undefined,{style:'currency',currency:menu.restaurant.currency});
  const summary = 'Draft order (not yet submitted):\n' +
    items.map(item => item.quantity+' × '+item.name+' — '+money.format(item.unit_price_minor*item.quantity/100)).join('\n') +
    '\nTotal: '+money.format(total/100)+'. Please explicitly confirm to place this order.';
  window.MarKhoorAssistant?.showNotice(summary);
  return {status:'draft',customer_name:name,items,total_minor:total,currency:menu.restaurant.currency,
    message:'Ask the customer to explicitly confirm before calling submit_order.'};
}
async function submitOrder(current, args) {
  if (!current.draft || args.confirmed !== true) throw Error('No confirmed draft');
  if (!current.confirmedSinceDraft || Date.now() - current.draftAt > 180000) throw Error('Please ask the customer to explicitly confirm the current order');
  if (current.submitResult) return current.submitResult;
  if (current.submitting) throw Error('Order submission already in progress');
  current.submitting = true;
  try {
    // Server rechecks active items, restaurant association, prices and request idempotency.
    const response = await fetch(voiceHolder.dataset.orderUrl, {
      method:'POST',headers:{'Content-Type':'application/json'},signal:current.controller.signal,
      body:JSON.stringify({...current.draft,client_request_id:current.requestId}),
    });
    const result = await response.json();
    if (response.status !== 201 || !Number.isSafeInteger(result.order_id) ||
        !/^[a-f0-9]{48}$/.test(result.tracking_token)) {
      if (response.status === 409) current.submitting = true; // no blind retry of an uncertain commit
      throw Error('Order not confirmed by the restaurant backend; do not tell customer it was placed');
    }
    current.submitResult = {status:'pending',order_id:result.order_id,total_minor:result.total_minor,
      tracking_token:result.tracking_token};
    window.MarKhoorAssistant?.showOrder(current.submitResult);
    window.MarKhoorAssistant?.showNotice('Order #'+result.order_id+' received by restaurant (pending acceptance).');
    current.closeAfterFinalReply = true;
    return {status:'pending',order_id:result.order_id,
      message:'Order received, awaiting restaurant acceptance. Thank the customer, give the order number and say goodbye.'};
  } finally {
    // Never resubmit after an uncertain network failure; a retry may duplicate a food order.
    current.submitting = true;
  }
}
async function processTool(current, item) {
  if (call !== current || !item?.call_id) return;
  let result;
  try {
    const args = JSON.parse(item.arguments || '{}');
    if (item.name === 'prepare_order') result = await prepareOrder(current,args);
    else if (item.name === 'submit_order') result = await submitOrder(current,args);
    else throw Error('Unsupported tool');
  } catch(error) {
    result = {status:'error',message:error.message || 'Tool unavailable'};
    if (!current.lastToolError || current.lastToolError !== result.message) window.MarKhoorAssistant?.showNotice('Order assistant: '+result.message);
    current.lastToolError = result.message;
  }
  if (!sendRealtime(current,{type:'conversation.item.create',item:{
    type:'function_call_output',call_id:item.call_id,output:JSON.stringify(result)
  }})) return;
  sendRealtime(current,{type:'response.create'});
}
function handleRealtime(current, payload) {
  if (!payload || call !== current) return;
  switch(payload.type) {
    case 'conversation.item.input_audio_transcription.delta':
      updateMessage(current,'user',payload.item_id || payload.event_id,String(payload.delta || ''),true);
      break;
    case 'conversation.item.input_audio_transcription.completed': {
      const transcript = String(payload.transcript || '').trim();
      updateMessage(current,'user',payload.item_id || payload.event_id,transcript);
      if (current.draft && explicitYes(transcript) && Date.now() - current.draftAt < 180000)
        current.confirmedSinceDraft = true;
      break;
    }
    case 'response.output_audio_transcript.delta':
    case 'response.output_text.delta':
      updateMessage(current,'assistant',payload.item_id || payload.response_id,
        String(payload.delta || ''),true);
      break;
    case 'response.output_audio_transcript.done':
    case 'response.output_text.done':
      updateMessage(current,'assistant',payload.item_id || payload.response_id,
        String(payload.transcript || payload.text || ''));
      break;
    case 'response.done': {
      const functions = (payload.response?.output || []).filter(x=>x.type==='function_call');
      for (const item of functions) processTool(current,item);
      if (!functions.length && current.closeAfterFinalReply && !current.finishTimer) {
        current.finalReplyDone = true;
        current.finishTimer = setTimeout(()=>{
          if (call===current) finish('Order submitted. Live conversation ended.');
        },5000);
      }
      break;
    }
    case 'output_audio_buffer.stopped':
      if (current.closeAfterFinalReply && current.finalReplyDone) finish('Order submitted. Live conversation ended.');
      break;
    case 'error':
      status.textContent = 'Realtime assistant reported an error. Please retry.';
      break;
  }
}
start?.addEventListener('click',async()=>{
  if (call) { finish('Voice ended.'); return; }
  start.disabled = true;
  status.textContent = 'Connecting…';
  setOrbState('connecting','Connecting…');
  const current = {peer:new RTCPeerConnection(),controller:new AbortController(),
    requestId:crypto.randomUUID(),draft:null,confirmedSinceDraft:false,submitting:false};
  call = current;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw Error('Microphone unavailable');
    const mic = await navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
    });
    if (call !== current) { mic.getTracks().forEach(track=>track.stop()); return; }
    current.mic = mic;
    for (const track of mic.getAudioTracks()) current.peer.addTrack(track,mic);
    const events = current.peer.createDataChannel('oai-events');
    current.events = events;
    events.addEventListener('message',event=>{
      if (call!==current) return;
      try { handleRealtime(current,JSON.parse(event.data)); } catch { /* ignore malformed event */ }
    });
    current.peer.ontrack = event => {
      if (call!==current) return;
      current.remote = event.streams[0] || new MediaStream([event.track]);
      audio.srcObject = current.remote;
      audio.play().catch(()=>{
        if (call!==current) return;
        audio.hidden = false; status.textContent = 'Connected. Tap play to hear the assistant.';
      });
      updateRecordingControls();
    };
    current.peer.onconnectionstatechange = ()=>{
      if (call!==current) return;
      const state = current.peer.connectionState;
      if (state==='connected') {
        clearTimeout(current.connectionTimeout);
        status.textContent = 'Voice connected. Speak naturally.';
        start.disabled = false; start.setAttribute('aria-label','End live conversation'); start.title='End live conversation'; start.setAttribute('aria-pressed','true');
        setOrbState('connected','Listening…');
        updateRecordingControls();
      } else if (state==='failed'||state==='closed') finish('Voice connection failed.');
    };
    current.peer.oniceconnectionstatechange = ()=>{
      if (call===current && current.peer.iceConnectionState==='failed')
        finish('Voice network connection failed.');
    };
    await current.peer.setLocalDescription(await current.peer.createOffer());
    await waitForIceGathering(current.peer,current.controller.signal);
    if (call!==current||current.controller.signal.aborted) return;
    const response = await fetch(voiceHolder.dataset.voiceUrl,{
      method:'POST',headers:{'Content-Type':'application/sdp'},
      body:current.peer.localDescription.sdp,signal:current.controller.signal
    });
    if (!response.ok) throw Error(voiceFailure(response.status,response.headers.get('X-Voice-Error')));
    const answer = await response.text();
    if (!answer.startsWith('v=0')) throw Error('Invalid voice response.');
    if (call!==current) return;
    await current.peer.setRemoteDescription({type:'answer',sdp:answer});
    if (current.peer.connectionState !== 'connected') {
      current.connectionTimeout=setTimeout(()=>{
        if (call===current && current.peer.connectionState!=='connected')
          finish('Voice connection timed out. Check microphone/network permissions.');
      },15000);
    }
  }catch(error){
    if (call!==current) return;
    const message=error?.name==='NotAllowedError'?'Microphone permission denied. Allow access in your browser.':
      error?.name==='NotFoundError'?'No microphone found.':
      error?.message?.startsWith('Voice ')||error?.message?.startsWith('Could not')?
      error.message:'Could not connect voice. Use text chat or retry.';
    finish(message);
  }
});


window.addEventListener('mar-khoor-assistant-close',()=>{if(call)finish('Voice ended.');});
window.MarKhoorVoice = {isActive:()=>Boolean(call)};
addEventListener('pagehide',()=>{
  if(call)finish('Voice ended.');
  if(recordingUrl)URL.revokeObjectURL(recordingUrl);
});
if(record){
  consent.addEventListener('change',()=>{
    if(!consent.checked)stopRecording(call);
    updateRecordingControls();
  });
  stopRecord.addEventListener('click',()=>stopRecording(call));
  record.addEventListener('click',async()=>{
    const current=call;
    if(!consent.checked||current?.peer?.connectionState!=='connected'||!current?.mic||
       !current?.remote||current.recorder?.state==='recording')return;
    record.disabled=true;
    let context;
    try{
      if(typeof MediaRecorder==='undefined')throw Error('Recorder unavailable');
      context=new AudioContext();await context.resume();
      if(call!==current||!consent.checked||current.peer.connectionState!=='connected'){
        await context.close();return;
      }
      const mix=context.createMediaStreamDestination();
      context.createMediaStreamSource(current.mic).connect(mix);
      context.createMediaStreamSource(current.remote).connect(mix);
      const preferred='audio/webm;codecs=opus';
      const options=MediaRecorder.isTypeSupported?.(preferred)?{mimeType:preferred}:{};
      const recorder=new MediaRecorder(mix.stream,options);
      const chunks=[];
      current.context=context;current.recorder=recorder;
      recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};
      recorder.onstop=()=>{
        context.close().catch(()=>{});
        if(recordingUrl)URL.revokeObjectURL(recordingUrl);
        const blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});
        recordingUrl=blob.size > 0 ? URL.createObjectURL(blob):null;
        if(recordingUrl){
          download.href=recordingUrl;
          download.download=recorder.mimeType?.includes('mp4')?'conversation.m4a':'conversation.webm';
          download.textContent='Download recorded conversation';download.hidden=false;
          if(call===current)status.textContent='Recording saved on this device.';
        }else if(call===current)status.textContent='Recording contained no audio.';
        updateRecordingControls();
      };
      recorder.start(1000);
      status.textContent='Recording both sides locally.';
      updateRecordingControls();
    }catch{
      context?.close().catch(()=>{});
      if(call===current){current.context=null;current.recorder=null;status.textContent='Recording unavailable.';}
      updateRecordingControls();
    }
  });
}
