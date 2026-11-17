# Restaurant customer-site live voice and local recording verification

The floating assistant uses the OpenAI Realtime WebRTC API. Each session is scoped to the selected published restaurant's active public menu. Voice does **not** submit orders, expose customer information, or allocate telephone numbers.

## Prerequisites

- A published restaurant website with its AI Assistant enabled.
- `RESTAURANT_WEBSITE_VOICE_ENABLED=true`, `OPENAI_API_KEY` and sufficient Realtime API model access/quota.
- A modern browser with HTTPS microphone permission and a functioning microphone and speaker.
- To show the recording control, the restaurant owner must explicitly enable **Allow recording** in the Website Builder settings and save. Each customer must independently check the recording consent box before the Start recording button becomes active.

## Browser test

1. Visit the published customer site, open the floating AI Assistant, and select **Start live conversation**.
2. Allow microphone access. The UI shows **Connecting...** until the peer connection actually reaches `connected`, then **Voice connected. You can speak now.**
3. Speak an item-specific question. The assistant should respond in audio using only the current restaurant's published menu data.
4. Open **Recording options**. Check the customer consent box. Start recording and verify **Stop recording** is available.
5. Stop recording or end the call. Only after the browser finalizes the recording should **Download recorded conversation** appear. Verify the file plays both sides. No recording is uploaded to Mar-Khoor by this feature.
6. Revoke consent mid-recording and check that recording ends. Verify another restaurant's menu does not appear in this restaurant's session.
7. Check with denied mic permission, missing device, API provider error, and a blocked network. These must display a useful error instead of remaining on Connecting indefinitely.

## Safety and rollback

Never print API keys, raw upstream error bodies, private calls, or SDP offers in reports. The server may return a limited `X-Voice-Error` category for debugging. Keep `RESTAURANT_WEBSITE_VOICE_ENABLED=false` as an emergency stop switch, and redeploy the prior main commit if a code rollback is needed.
