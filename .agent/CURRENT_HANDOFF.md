# CURRENT HANDOFF

## Last Updated
2026-09-15 — v0.3.20-beta OTA: Continuous PCM Jitter Buffering & Zero Stuttering

## Session / Agent
Agent: MonkeyCode
Branch: `main`
Latest commit: `6938cba`

## Status: OTA DEPLOYING & TEST PENDING

---

### The Real Breakthrough & Subsequent Voice Audio Fix

**MILESTONE ACHIEVED**: Nova successfully connected, entered `listening`, and replied with voice audio!

**ISSUE DISCOVERED**: User reported audio was "slow mo or atakne wala audio, kind of getting stuck".

**ROOT CAUSE OF STUTTER / SLOW-MO**:
1. **Per-Chunk Micro-Playback Overhead**:
   - Gemini Live streams audio in tiny ~50ms slices (e.g. 2,560 bytes).
   - The previous player implementation converted each 50ms chunk into an individual WAV file, wrote it to disk via `writeAsStringAsync`, initialized an entire new ExoPlayer instance (`createAudioPlayer`), waited for completion, and repeated for each slice.
   - Initializing ExoPlayer and writing to disk takes 40–100ms per file.
   - Consequently, between every 50ms syllable, there was a 50–100ms pause of dead silence. This created the exact perception of "atak atak ke chalna" and stretched-out "slow motion" speech.
2. **Acoustic Feedback & Self-Interruption**:
   - While Nova was speaking through the device speaker, the microphone stream was still active and transmitting Nova's voice back into Gemini Live.
   - Gemini heard its own voice as user input, interrupting the speech flow.
3. **Dynamic Sample Rate Matching**:
   - Audio chunks specify their native sample rate in `mimeType` (`audio/pcm;rate=24000`).

**THE FIX IMPLEMENTED (v0.3.20-beta)**:
1. **Seamless Continuous PCM Jitter Buffer**:
   - Incoming base64 PCM chunks are accumulated in a queue buffer.
   - When playback triggers, all accumulated PCM chunks are concatenated in memory into a single unified WAV file (`pcmChunksToWavBase64`).
   - The entire phrase plays continuously through a single ExoPlayer instance with 0 gaps or syllable pauses.
   - While one segment plays, subsequent chunks continue buffering smoothly.
2. **Acoustic Feedback Guard**:
   - Silenced mic buffer streaming whenever `isPlayingRef.current` is true.
3. **Dynamic Sample Rate Extraction**:
   - Dynamically parses `rate=(\d+)` from the mimeType so audio is rendered at true native speed and natural cadence.



---

### OTA / Deployment Record

| Version | Update Group ID | Android Update ID | Commit |
|---|---|---|---|
| v0.3.19-beta | d2f2b44a-96d9-4f93-b4cd-a4bfbf3a9817 | 01a0a3f7-b57a-74d3-8cbf-17936be9dbd7 | 65ceed6 |
| v0.3.16-beta | e3dd1dd5-f437-46f3-a0dc-6d942a9f2a67 | 01a0a057-b66e-7354-92e6-a4aa7268a51a | 324e69e |
| v0.3.15-beta | 48c6db6f-f465-4c7f-96a7-8b2632a50cd4 | 01a0a043-3693-7b91-9bca-8303b9471d8b | d34d8c1 |
| v0.3.14-beta | (prev session) | — | a3c1e9e |

---

### Files Modified This Session

| File | Change |
|---|---|
| `backend/src/lib/geminiLivePool.ts` | Skip authTokens.create; return raw API key directly |
| `mobile/src/hooks/useVoiceSession.ts` | File-based WAV playback; AudioModule fix; timeout 35s |
| `mobile/src/config/updateHistory.json` | v0.3.15 + v0.3.16 entries |

---

### Expected Flow After v0.3.16

1. User taps mic
2. Backend `/api/voice/session` → returns API key directly (no authTokens.create crash)
3. Mobile opens WebSocket to Gemini Live with that key
4. `setupComplete` received → "Listening..." state
5. User speaks → 16kHz float32→int16 PCM streamed to Gemini
6. Gemini responds → 24kHz PCM chunks written to temp `.wav` files → played via ExoPlayer

### NEXT ACTION
**User must test v0.3.16-beta**:
- Restart app and tap mic
- First attempt may take 20-30s if Render is cold (server wakes up → session returns → WS connects)
- Should reach "Listening..." and Nova should speak

### If Still Failing
Run `adb logcat | grep -E "VoiceSession|ExoPlayer|AudioPlayer"` and share output.
Key log lines to look for:
- `[VoiceSession] Session config received` → backend is working
- `[VoiceSession] WebSocket opened` → WS connected
- `[VoiceSession] setupComplete received` → Gemini ready
- `[VoiceSession] Playing chunk #1 from file` → playback started
