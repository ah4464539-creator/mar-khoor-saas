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

function finish(message) {
  const current = call;
  call = undefined;
  if (current?.connectionTimeout) clearTimeout(current.connectionTimeout);
  current?.controller.abort();
  stopRecording(current);
  current?.peer.close();
  current?.mic?.getTracks().forEach(track => track.stop());
  // A recording is finalized asynchronously by MediaRecorder.onstop.
  // Closing AudioContext here would truncate the last recorded chunks.
  if (!current?.recorder) current?.context?.close().catch(() => {});
  audio.pause();
  audio.srcObject = null;
  audio.hidden = true;
  start.disabled = false;
  stop.disabled = true;
  status.textContent = message;
  updateRecordingControls();
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

function voiceFailure(statusCode, reason) {
  if (reason === 'quota_unavailable') return 'Voice credits or quota are unavailable. Try text chat.';
  if (reason === 'invalid_credentials' || reason === 'permission_denied') return 'Voice API access is not configured correctly. Use text chat.';
  if (reason === 'model_unavailable') return 'This voice model is unavailable for the project. Use text chat.';
  if (reason === 'rate_limited' || statusCode === 429) return 'Too many voice requests. Try again later.';
  if (statusCode === 503) return 'Voice service is temporarily unavailable. Try text chat.';
  return 'Could not start voice. Try again or use text chat.';
}

start.addEventListener('click', async () => {
  if (call) return;
  start.disabled = true;
  stop.disabled = false;
  status.textContent = 'Connecting…';
  const current = { peer: new RTCPeerConnection(), controller: new AbortController() };
  call = current;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('microphone_unavailable');
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (call !== current) {
      mic.getTracks().forEach(track => track.stop());
      return;
    }
    current.mic = mic;
    for (const track of mic.getAudioTracks()) current.peer.addTrack(track, mic);

    // Realtime WebRTC uses this channel for session/error events. It must
    // exist before createOffer so it is negotiated with the media tracks.
    const events = current.peer.createDataChannel('oai-events');
    events.addEventListener('message', event => {
      if (call !== current) return;
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'error') status.textContent = 'Voice session error. End the call and try again.';
      } catch { /* Ignore non-JSON event messages. */ }
    });

    current.peer.ontrack = event => {
      if (call !== current) return;
      current.remote = event.streams[0] || new MediaStream([event.track]);
      audio.srcObject = current.remote;
      audio.play().catch(() => {
        if (call !== current) return;
        audio.hidden = false;
        status.textContent = 'Voice connected. Select play to hear the assistant.';
      });
      updateRecordingControls();
    };
    current.peer.onconnectionstatechange = () => {
      if (call !== current) return;
      const state = current.peer.connectionState;
      if (state === 'connected') {
        clearTimeout(current.connectionTimeout);
        status.textContent = 'Voice connected. You can speak now.';
        updateRecordingControls();
      } else if (state === 'failed' || state === 'closed') {
        finish('Voice connection failed. Check your network or use text chat.');
      }
    };
    current.peer.oniceconnectionstatechange = () => {
      if (call === current && current.peer.iceConnectionState === 'failed')
        finish('Voice network connection failed. Check your internet or use text chat.');
    };

    await current.peer.setLocalDescription(await current.peer.createOffer());
    await waitForIceGathering(current.peer, current.controller.signal);
    if (call !== current || current.controller.signal.aborted) return;
    const response = await fetch(start.closest('[data-voice-url]').dataset.voiceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      signal: current.controller.signal,
      body: current.peer.localDescription.sdp,
    });
    if (!response.ok) {
      const reason = response.headers.get('X-Voice-Error');
      throw new Error(voiceFailure(response.status, reason));
    }
    const answer = await response.text();
    if (!answer.startsWith('v=0')) throw new Error('Invalid voice response. Please retry.');
    if (call !== current) return;
    await current.peer.setRemoteDescription({ type: 'answer', sdp: answer });
    if (current.peer.connectionState !== 'connected') {
      current.connectionTimeout = setTimeout(() => {
        if (call === current && current.peer.connectionState !== 'connected')
          finish('Voice connection timed out. Check microphone and network permissions.');
      }, 15000);
    }
  } catch (error) {
    if (call !== current) return;
    const message = error?.name === 'NotAllowedError'
      ? 'Microphone permission denied. Allow microphone access in Chrome and try again.'
      : error?.name === 'NotFoundError'
        ? 'No microphone found. Connect a microphone and try again.'
        : error?.name === 'AbortError'
          ? 'Voice request timed out. Try again or use text chat.'
          : error?.message?.startsWith('Voice ') || error?.message?.startsWith('Could not') || error?.message?.startsWith('Invalid ')
            ? error.message
            : 'Could not connect. Check microphone access or use text chat.';
    finish(message);
  }
});

stop.addEventListener('click', () => finish('Voice ended.'));
addEventListener('pagehide', () => {
  if (call) finish('Voice ended.');
  if (recordingUrl) URL.revokeObjectURL(recordingUrl);
});

if (record) {
  consent.addEventListener('change', () => {
    if (!consent.checked) stopRecording(call);
    updateRecordingControls();
  });
  stopRecord.addEventListener('click', () => stopRecording(call));
  record.addEventListener('click', async () => {
    const current = call;
    if (!consent.checked || current?.peer?.connectionState !== 'connected' ||
        !current?.mic || !current?.remote || current.recorder?.state === 'recording') return;
    record.disabled = true;
    let context;
    try {
      if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder unsupported');
      context = new AudioContext();
      await context.resume();
      if (call !== current || !consent.checked || current.peer.connectionState !== 'connected') {
        await context.close();
        return;
      }
      const mix = context.createMediaStreamDestination();
      context.createMediaStreamSource(current.mic).connect(mix);
      context.createMediaStreamSource(current.remote).connect(mix);
      const preferred = 'audio/webm;codecs=opus';
      const options = MediaRecorder.isTypeSupported?.(preferred) ? { mimeType: preferred } : {};
      const recorder = new MediaRecorder(mix.stream, options);
      const parts = [];
      current.context = context;
      current.recorder = recorder;
      recorder.ondataavailable = event => { if (event.data?.size) parts.push(event.data); };
      recorder.onstop = () => {
        context.close().catch(() => {});
        if (recordingUrl) URL.revokeObjectURL(recordingUrl);
        recordingUrl = null;
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(parts, { type: mimeType });
        if (blob.size > 0) {
          recordingUrl = URL.createObjectURL(blob);
          download.href = recordingUrl;
          download.download = mimeType.includes('mp4') ? 'conversation.m4a' : 'conversation.webm';
          download.textContent = 'Download recorded conversation';
          download.hidden = false;
          if (call === current) status.textContent = 'Recording saved locally. Download it below.';
        } else if (call === current) {
          status.textContent = 'Recording captured no audio. Please retry.';
        }
        updateRecordingControls();
      };
      recorder.start(1000);
      status.textContent = 'Recording both sides on this device';
      updateRecordingControls();
    } catch {
      context?.close().catch(() => {});
      if (call === current) {
        current.context = null;
        current.recorder = null;
        status.textContent = 'Recording is unavailable in this browser.';
      }
      updateRecordingControls();
    }
  });
}
