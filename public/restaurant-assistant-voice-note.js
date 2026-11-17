// Customer voice note -> explicit Send -> server transcription -> ordinary AI text chat.
// Never records the realtime AI call; microphone tracks stop after each voice note.
(() => {
  const record = document.querySelector('#start-voice-note');
  if (!record) return; // The restaurant owner has not enabled voice notes.
  const stop = document.querySelector('#stop-voice-note');
  const send = document.querySelector('#send-voice-note');
  const cancel = document.querySelector('#cancel-voice-note');
  const status = document.querySelector('#voice-note-status');
  const form = document.querySelector('#assistant form');
  const input = form.elements.message;
  const url = record.closest('[data-transcribe-url]').dataset.transcribeUrl;
  let stream;
  let recorder;
  let chunks = [];
  let voiceNote;
  let timer;
  let generation = 0;
  let sending = false;
  let pending;

  function message(text) { if (status) status.textContent = text; }
  function stopMicrophone() {
    clearTimeout(timer);
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
  }
  function reset() {
    generation++;
    pending?.abort();
    pending = undefined;
    voiceNote = undefined;
    chunks = [];
    if (recorder?.state === 'recording') recorder.stop();
    recorder = undefined;
    stopMicrophone();
    sending = false;
    record.hidden = false;
    record.disabled = false;
    stop.hidden = true;
    send.hidden = true;
    cancel.hidden = true;
    send.disabled = false;
  }
  const supported = () => typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const preferredMime = () => {
    for (const mime of ['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus','audio/webm']) {
      if (MediaRecorder.isTypeSupported?.(mime)) return mime;
    }
    return '';
  };
  record.addEventListener('click', async () => {
    if (window.MarKhoorVoice?.isActive()) {
      message('Close live conversation before recording a voice message.'); return;
    }
    if (!supported()) { message('Voice notes are unavailable in this browser. Use text chat.'); return; }
    reset();
    const token = generation;
    record.disabled = true;
    message('Requesting microphone…');
    try {
      const mic = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
      if (generation !== token) { mic.getTracks().forEach(track => track.stop()); return; }
      stream = mic;
      const mimeType = preferredMime();
      recorder = new MediaRecorder(mic, mimeType ? {mimeType} : undefined);
      const current = recorder;
      chunks = [];
      current.ondataavailable = event => { if (generation === token && event.data?.size) chunks.push(event.data); };
      current.onstop = () => {
        stopMicrophone();
        if (generation !== token) return;
        const type = current.mimeType?.split(';')[0] || 'audio/webm';
        voiceNote = new Blob(chunks,{type});
        chunks = [];
        stop.hidden = true;
        if (!voiceNote.size || voiceNote.size > 4*1024*1024) {
          message('Voice message is empty or too large. Record a shorter message.');
          reset(); return;
        }
        send.hidden = false;
        cancel.hidden = false;
        message('Voice message ready. Tap Send to transcribe and ask AI.');
      };
      current.onerror = () => { message('Microphone recording failed.'); reset(); };
      current.start(1000);
      record.hidden = true;
      stop.hidden = false;
      cancel.hidden = false;
      message('Recording your voice message…');
      timer = setTimeout(() => { if (current.state === 'recording') current.stop(); },60000);
    } catch (error) {
      const denied = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError';
      reset();
      message(denied ? 'Microphone permission denied.' : 'Could not start voice recording.');
    }
  });
  stop.addEventListener('click', () => {
    if (recorder?.state === 'recording') recorder.stop();
  });
  cancel.addEventListener('click', () => { reset(); message('Voice message discarded.'); });
  send.addEventListener('click', async () => {
    if (!voiceNote || sending) return;
    if (form.querySelector?.('button[type="submit"]')?.disabled) { message('Wait for the current AI reply before sending your voice message.'); return; }
    if (window.MarKhoorVoice?.isActive()) { message('Close live conversation before sending a voice note.'); return; }
    sending = true;
    send.disabled = true;
    const token = generation;
    pending = new AbortController();
    message('Transcribing voice message…');
    try {
      const response = await fetch(url, {
        method:'POST',headers:{'Content-Type':voiceNote.type},body:voiceNote,
        signal:pending.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || typeof payload?.text !== 'string' || !payload.text.trim()) {
        throw new Error('Transcription unavailable. Please try again or type your message.');
      }
      if (token !== generation) return;
      const transcript = payload.text.trim();
      if (transcript.length > 1200) throw new Error('Voice message is too long.');
      // The regular chat form displays the transcribed words, obtains the restaurant AI reply,
      // and preserves the existing chat history. No audio is persisted in browser storage.
      reset();
      message('Voice message transcribed and sent.');
      input.value = transcript;
      form.requestSubmit();
    } catch (error) {
      if (token !== generation) return;
      sending = false;
      send.disabled = false;
      message(error?.name === 'AbortError' ? 'Voice message cancelled.' :
        error?.message || 'Could not transcribe voice message.');
    } finally {
      if (token === generation) pending = undefined;
    }
  });
  window.addEventListener('mar-khoor-assistant-close',() => {
    if (stream || voiceNote || sending || record.disabled) reset();
  });
  window.MarKhoorVoiceNote = {isActive:() => Boolean(stream || voiceNote || sending || record.disabled)};
  addEventListener('pagehide', reset);
})();