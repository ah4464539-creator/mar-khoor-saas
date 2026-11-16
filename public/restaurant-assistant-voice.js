const start = document.querySelector('#start-voice');
const stop = document.querySelector('#stop-voice');
const status = document.querySelector('#voice-status');
const audio = document.querySelector('#assistant-audio');
const consent = document.querySelector('#record-consent');
const record = document.querySelector('#start-recording');
const stopRecord = document.querySelector('#stop-recording');
const download = document.querySelector('#recording-download');
let call;
let recordingUrl;

function finish(message) {
  const current = call;
  call = undefined;
  current?.controller.abort();
  if (current?.recorder?.state === 'recording') current.recorder.stop();
  current?.peer.close();
  current?.mic?.getTracks().forEach(track => track.stop());
  current?.context?.close().catch(() => {});
  audio.srcObject = null;
  start.disabled = false;
  stop.disabled = true;
  status.textContent = message;
  if (record) record.disabled = true;
}

start.addEventListener('click', async () => {
  start.disabled = true;
  stop.disabled = false;
  status.textContent = 'Connecting…';
  const current = { peer: new RTCPeerConnection(), controller: new AbortController() };
  call = current;
  try {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (call !== current) {
      mic.getTracks().forEach(track => track.stop());
      return;
    }
    current.mic = mic;
    for (const track of mic.getAudioTracks()) current.peer.addTrack(track, mic);
    current.peer.ontrack = event => {
      if (call !== current) return;
      current.remote = event.streams[0] || new MediaStream([event.track]);
      audio.srcObject = current.remote;
      audio.play().catch(() => { status.textContent = 'Use the audio player to enable sound.'; });
      if (record) record.disabled = !consent.checked;
    };
    current.peer.onconnectionstatechange = () => {
      if (call !== current) return;
      if (current.peer.connectionState === 'connected') status.textContent = 'Voice connected';
      if (['failed', 'disconnected'].includes(current.peer.connectionState)) finish('Voice disconnected. You can start again or use text.');
    };
    await current.peer.setLocalDescription(await current.peer.createOffer());
    const response = await fetch(start.closest('[data-voice-url]').dataset.voiceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      signal: current.controller.signal,
      body: current.peer.localDescription.sdp,
    });
    if (!response.ok) throw new Error('Voice unavailable');
    const answer = await response.text();
    if (call === current) await current.peer.setRemoteDescription({ type: 'answer', sdp: answer });
  } catch {
    if (call === current) finish('Could not connect. Check microphone access or use text.');
  }
});

stop.addEventListener('click', () => finish('Voice ended.'));
addEventListener('pagehide', () => finish('Voice ended.'));

if (record) {
  consent.addEventListener('change', () => {
    if (!consent.checked && call?.recorder?.state === 'recording') call.recorder.stop();
    record.disabled = !consent.checked || !call?.remote || call?.recorder?.state === 'recording';
  });
  stopRecord.addEventListener('click', () => {
    if (call?.recorder?.state === 'recording') call.recorder.stop();
  });
  record.addEventListener('click', async () => {
    const current = call;
    if (!consent.checked || !current?.remote || current.recorder?.state === 'recording') return;
    record.disabled = true;
    let context;
    try {
      context = new AudioContext();
      await context.resume();
      if (call !== current || !consent.checked) {
        await context.close();
        return;
      }
      const mix = context.createMediaStreamDestination();
      context.createMediaStreamSource(current.mic).connect(mix);
      context.createMediaStreamSource(current.remote).connect(mix);
      const recorder = new MediaRecorder(mix.stream);
      const parts = [];
      current.context = context;
      current.recorder = recorder;
      recorder.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
      recorder.onstop = () => {
        context.close().catch(() => {});
        recordingUrl && URL.revokeObjectURL(recordingUrl);
        const mimeType = recorder.mimeType || 'audio/webm';
        recordingUrl = URL.createObjectURL(new Blob(parts, { type: mimeType }));
        download.href = recordingUrl;
        download.download = mimeType.includes('mp4') ? 'conversation.m4a' : 'conversation.webm';
        download.hidden = false;
        stopRecord.disabled = true;
        record.disabled = !consent.checked || !call?.remote;
        if (call === current) status.textContent = 'Recording stopped. Download your copy below.';
      };
      recorder.start();
      stopRecord.disabled = false;
      status.textContent = 'Recording both sides of this call';
    } catch {
      context?.close().catch(() => {});
      record.disabled = !consent.checked || !call?.remote;
      status.textContent = 'Recording is unavailable in this browser.';
    }
  });
}
