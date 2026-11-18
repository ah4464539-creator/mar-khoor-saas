const assistant = document.querySelector('#assistant');
const viewport = window.visualViewport;
function syncAssistantViewport() {
  if (!viewport) return;
  if (!window.matchMedia('(max-width: 720px)').matches) {
    assistant.style.removeProperty('--assistant-viewport-top');
    assistant.style.removeProperty('--assistant-viewport-height');
    return;
  }
  assistant.style.setProperty('--assistant-viewport-top', Math.max(0, viewport.offsetTop)+'px');
  assistant.style.setProperty('--assistant-viewport-height', Math.max(220, viewport.height)+'px');
}
viewport?.addEventListener('resize',syncAssistantViewport);
viewport?.addEventListener('scroll',syncAssistantViewport);
window.addEventListener('resize',syncAssistantViewport);
syncAssistantViewport();
const launcher = assistant.querySelector('summary');
const form = assistant.querySelector('form');
const input = form.elements.message;
const submit = form.querySelector('button[type="submit"]');
// iOS Safari dismisses the keyboard on a submit-button tap unless focus is preserved.
submit.addEventListener('pointerdown', event => {
  if (event.pointerType === 'touch' && document.activeElement === input) event.preventDefault();
});
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    if (form.requestSubmit) form.requestSubmit(submit);
    else submit.click();
  }
});
const messages = assistant.querySelector('[data-assistant-messages]');
const history = []; // Current tab and restaurant only.
const voiceRows = new Map();
const card = document.querySelector('#assistant-order-card');
const details = document.querySelector('#assistant-order-details');
const orderStatus = document.querySelector('#assistant-order-status');
const orderLink = document.querySelector('#assistant-order-link');
const slug = decodeURIComponent(new URL(form.action).pathname.split('/')[2] || '');
const orderKey = 'mar-khoor.order.' + slug;
const speakSupported = 'speechSynthesis' in window;
let activeOrder;
let pendingChatOrder = null;
let pollTimer;

function messageNode(role, content) {
  const row = document.createElement('p');
  row.className = role === 'user' ? 'assistant-question' : 'assistant-reply';
  const body = document.createElement('span');
  body.textContent = content;
  row.append(body);
  if (role === 'assistant' && speakSupported) {
    const speaker = document.createElement('button');
    speaker.type = 'button';
    speaker.className = 'assistant-speak';
    speaker.title = 'Listen to this reply';
    speaker.setAttribute('aria-label', 'Listen to this reply');
    speaker.textContent = '🔊';
    speaker.addEventListener('click', () => {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(body.textContent.slice(0, 2500));
      utterance.lang = navigator.language || 'en-US';
      speechSynthesis.speak(utterance);
    });
    row.append(speaker);
  }
  messages.append(row);
  messages.scrollTop = messages.scrollHeight;
  return body;
}

function upsertVoiceMessage(role, itemId, text, append = false) {
  if (typeof itemId !== 'string' || !itemId || typeof text !== 'string') return;
  const key = role + ':' + itemId;
  let body = voiceRows.get(key);
  if (!body) {
    body = messageNode(role, '');
    voiceRows.set(key, body);
  }
  body.textContent = (append ? body.textContent : '') + text.slice(0, 1200);
  messages.scrollTop = messages.scrollHeight;
}

function showNotice(text) { messageNode('assistant', text); }

function renderOrder(order) {
  details.replaceChildren();
  const node = (tag, content) => Object.assign(document.createElement(tag), {textContent: content});
  details.append(node('p', 'Order #' + order.order_id + ' · ' + order.restaurant_name));
  const money = new Intl.NumberFormat(undefined, {style:'currency',currency:order.currency || 'PKR'});
  for (const item of Array.isArray(order.items) ? order.items : []) {
    if (!Number.isFinite(Number(item.quantity))) continue;
    const line = node('p', item.quantity + ' × ' + item.name + ' — ' +
      money.format(Number(item.unit_price_minor || 0)*Number(item.quantity)/100));
    details.append(line);
  }
  details.append(node('strong', 'Total: ' + money.format(Number(order.total_minor)/100)));
  const labels = {pending:'Received — awaiting restaurant acceptance',accepted:'Accepted by restaurant',
    preparing:'Being prepared',ready:'Ready',completed:'Completed',cancelled:'Cancelled'};
  const statusText = labels[order.status] || 'Status unavailable';
  let eta = '';
  const epoch = Number(order.estimated_ready_epoch);
  if (order.estimated_ready_epoch != null && Number.isFinite(epoch) && epoch > 0 &&
      !['completed','cancelled'].includes(order.status)) {
    const remaining = Math.ceil((epoch*1000-Date.now())/60000);
    eta = remaining > 0 ? ' · Estimated ready in about ' + remaining + ' minute' + (remaining===1?'':'s') :
      ' · Estimated time passed; awaiting restaurant update';
    eta += ' (' + new Date(epoch*1000).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) + ')';
  }
  orderStatus.textContent = statusText + eta;
  card.hidden = false;
}

async function loadOrder() {
  clearTimeout(pollTimer);
  if (!activeOrder || !assistant.isConnected) return;
  const saved = activeOrder;
  try {
    const response = await fetch('/api/public/orders/'+saved.id+'/status', {
      headers:{'X-Tracking-Token':saved.token},cache:'no-store',signal:AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error('Status temporarily unavailable');
    const order = await response.json();
    if (activeOrder !== saved || order.restaurant_slug !== slug) throw new Error('Order mismatch');
    renderOrder(order);
    if (!['completed','cancelled'].includes(order.status)) pollTimer = setTimeout(loadOrder, 15000);
  } catch {
    orderStatus.textContent = 'Waiting for the latest restaurant status. Try the full tracking link.';
    pollTimer = setTimeout(loadOrder, 15000);
  }
}

function showOrder(receipt) {
  if (!Number.isSafeInteger(receipt?.order_id) || !/^[a-f0-9]{48}$/.test(receipt?.tracking_token || '')) return;
  activeOrder = {id:receipt.order_id,token:receipt.tracking_token};
  try { sessionStorage.setItem(orderKey, JSON.stringify(activeOrder)); } catch {}
  orderLink.href = '/track.html#' + new URLSearchParams({id:activeOrder.id,t:activeOrder.token,view:'tracking'});
  card.hidden = false;
  orderStatus.textContent = 'Order #' + activeOrder.id + ' received. Checking restaurant status…';
  loadOrder();
}

try {
  const saved = JSON.parse(sessionStorage.getItem(orderKey) || 'null');
  if (Number.isSafeInteger(saved?.id) && /^[a-f0-9]{48}$/.test(saved.token)) {
    activeOrder = saved;
    orderLink.href = '/track.html#' + new URLSearchParams({id:saved.id,t:saved.token,view:'tracking'});
    loadOrder();
  }
} catch {}

window.MarKhoorAssistant = {upsertVoiceMessage, showNotice, showOrder};

input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); form.requestSubmit();
  }
});

assistant.querySelector('[data-close-assistant]').addEventListener('click', closePanel);
assistant.addEventListener('keydown', event => {
  if (event.key === 'Escape' && assistant.open) closePanel();
});
launcher.addEventListener('click', event => {
  event.preventDefault();
  if (assistant.open) closePanel();
  else openPanel();
});
if (location.hash === '#assistant') openPanel();
function openPanel() { assistant.open = true; input.focus({preventScroll:true}); }
function closePanel() {
  window.dispatchEvent(new Event('mar-khoor-assistant-close'));
  assistant.open = false; launcher.focus();
}

const dictate = document.querySelector('#assistant-dictate');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (dictate) {
  dictate.addEventListener('click', () => {
    if (!SpeechRecognition) { showNotice('Voice typing is unavailable in this browser. Use text chat.'); return; }
    if (window.MarKhoorVoice?.isActive()) { showNotice('End the live voice session before voice typing.'); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    dictate.disabled = true; dictate.setAttribute('aria-label','Listening for a text message');
    recognition.onresult = event => {
      const text = event.results?.[0]?.[0]?.transcript?.trim();
      if (!text) return;
      input.value = text.slice(0, 1200);
      form.requestSubmit();
    };
    recognition.onerror = () => showNotice('Could not recognize speech. Please type or try again.');
    recognition.onend = () => { dictate.disabled = false; dictate.setAttribute('aria-label','Speak a text message'); };
    try { recognition.start(); } catch { dictate.disabled = false; }
  });
}

const audioMessage = document.querySelector('#assistant-audio-message');
let messageRecorder, messageStream, messageChunks = [], messageBusy = false;
async function finishAudioMessage() {
  if (!messageRecorder || messageRecorder.state !== 'recording') return;
  messageRecorder.stop();
}
if (audioMessage) {
  audioMessage.addEventListener('click', async () => {
    if (messageBusy) return;
    if (messageRecorder?.state === 'recording') { await finishAudioMessage(); return; }
    if (window.MarKhoorVoice?.isActive()) { showNotice('End live conversation before recording a voice message.'); return; }
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw Error('Audio recording unsupported');
      messageStream = await navigator.mediaDevices.getUserMedia({audio:true});
      const mime = ['audio/webm','audio/mp4','audio/ogg'].find(x=>MediaRecorder.isTypeSupported(x));
      if (!mime) throw Error('Audio recording unsupported');
      messageRecorder = new MediaRecorder(messageStream,{mimeType:mime});
      messageChunks = [];
      messageRecorder.ondataavailable = e => { if(e.data?.size) messageChunks.push(e.data); };
      messageRecorder.onstop = async () => {
        messageStream?.getTracks().forEach(t=>t.stop()); messageStream = null;
        audioMessage.setAttribute('aria-pressed','false');
        audioMessage.setAttribute('aria-label','Record voice message');
        audioMessage.title = 'Record voice message';
        messageBusy = true; audioMessage.disabled = true;
        try {
          const blob = new Blob(messageChunks,{type:mime});
          if(blob.size > 2*1024*1024) throw Error('Recording too long (2 MB maximum)');
          const url = form.action.replace(/\/$/,'') + '/transcribe';
          const response = await fetch(url,{method:'POST',headers:{'Content-Type':mime},body:blob,signal:AbortSignal.timeout(25000)});
          const result = await response.json();
          if(!response.ok || !result.text) throw Error(result.error || 'Could not transcribe recording');
          input.value = result.text.slice(0,1200);
          form.requestSubmit();
        } catch(err) { showNotice(err.message || 'Could not send recording'); }
        finally { messageBusy=false; audioMessage.disabled=false; messageRecorder=null; messageChunks=[]; }
      };
      messageRecorder.start();
      audioMessage.setAttribute('aria-pressed','true');
      audioMessage.setAttribute('aria-label','Send recorded voice message');
      audioMessage.title='Send recording (or press Enter)';
    } catch(err) {
      messageStream?.getTracks().forEach(t=>t.stop()); messageStream=null;
      showNotice(err.message || 'Microphone unavailable');
    }
  });
  assistant.addEventListener('keydown',event=>{
    if(event.key==='Enter' && messageRecorder?.state==='recording' && !event.shiftKey){
      event.preventDefault(); finishAudioMessage();
    }
  });
  window.addEventListener('pagehide',()=>messageStream?.getTracks().forEach(t=>t.stop()));
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || submit.disabled) return;
  submit.disabled = true; input.value = '';
  messageNode('user', message);
  const reply = messageNode('assistant', 'Thinking…');
  try {
    const confirmation = /^(?:yes|yeah|yep|han|haan|hanji|haanji|ji|confirm|confirmed|ok|okay|bilkul|theek hai|kar do|kardo|place order|submit order|हाँ|हां|जी|हाँ जी|हां जी|ठीक है|کنفرم|ہاں|جی)$/iu;
    if (pendingChatOrder && confirmation.test(message.trim().replace(/[.!?।]+$/u,''))) {
      const order = pendingChatOrder;
      pendingChatOrder = null; // Never retry a submitted order automatically.
      const checkout = await fetch('/api/public/restaurants/'+encodeURIComponent(slug)+'/orders',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({customer_name:order.customer_name,
          items:order.items.map(({menu_item_id,quantity})=>({menu_item_id,quantity})),
          client_request_id:crypto.randomUUID()}),signal:AbortSignal.timeout(20000)
      });
      const receipt = await checkout.json();
      if (!checkout.ok || !Number.isSafeInteger(receipt.order_id) || !receipt.tracking_token)
        throw new Error(receipt.error || 'Order not received');
      showOrder(receipt);
      reply.textContent = 'Order #'+receipt.order_id+' received! Status: Pending restaurant acceptance. Your tracking details are shown above.';
      return;
    }
    if (pendingChatOrder) pendingChatOrder = null;
    const response = await fetch(form.action, {
      method:'POST',
      headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({message,history}),
      signal:AbortSignal.timeout(26000)
    });
    const data = await response.json();
    if (!response.ok) throw new Error('Assistant unavailable');
    reply.textContent = typeof data.reply === 'string' ? data.reply : 'The assistant is temporarily unavailable.';
    if (data.draft && Array.isArray(data.draft.items) && data.draft.items.length) {
      pendingChatOrder = data.draft;
      const money = new Intl.NumberFormat(undefined,{style:'currency',currency:data.draft.currency || 'PKR'});
      const lines = data.draft.items.map(item => item.quantity+' × '+item.name+' — '+money.format(item.unit_price_minor*item.quantity/100));
      reply.textContent = 'Order for '+data.draft.customer_name+':\n'+lines.join('\n')+
        '\nTotal: '+money.format(data.draft.total_minor/100)+
        '\nConfirm this order? Reply Yes / Han to submit it directly to the restaurant.';
    }
    if (data.source === 'ai') {
      history.push({role:'user',content:message.slice(0,1200)},
        {role:'assistant',content:reply.textContent.slice(0,1200)});
      while (history.length > 6 || history.reduce((size, entry) => size + entry.content.length,0)>4000) history.splice(0,2);
    }
  } catch {
    reply.textContent = 'Could not connect. Please try again.';
  } finally {
    submit.disabled = false;
    if (assistant.open && document.activeElement === submit) input.focus({preventScroll:true});
    messages.scrollTop = messages.scrollHeight;
  }
});
