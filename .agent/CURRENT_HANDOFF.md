# CURRENT HANDOFF

## Last Updated
2026-09-14 — v0.3.16-beta OTA live + Backend redeployed (88129e7)

## Session / Agent
Agent: MonkeyCode
Branch: `main`
Latest commit: `324e69e`

## Status: NEEDS USER TEST

---

### The Full Root Cause Chain (finally complete)

**ORIGINAL SYMPTOM**: "Connecting to Nova..." → timeout → error on every attempt.

**v0.3.12–13**: Stuck connecting (setAudioModeAsync blocking) + no audio (wrong API for recording).

**v0.3.14**: Connecting fixed. Reached "Listening..." but NO VOICE from Nova.
- Data: URI playback fails silently in ExoPlayer (fixed in v0.3.15)

**v0.3.15**: Better playback path. BUT still "Connection timed out" in 12s.
- **REAL ROOT CAUSE**: Backend `/api/voice/session` returning **HTTP 500** on every request.
- `authTokens.create` (Google SDK) requires a special Google Cloud IAM permission
  that standard AI Studio API keys do NOT have. Every call throws `"fetch failed"`.
- This means the backend crashed before ever returning session config to mobile.
- Mobile got no session → connection timed out after 12 seconds.

**v0.3.16**: 
- **Backend fixed**: Skip `authTokens.create` entirely. Return raw API key directly.
- **Timeout increased**: 12s → 35s (handles Render free-tier cold starts of 20-30s).

---

### OTA / Deployment Record

| Version | Update Group ID | Android Update ID | Commit |
|---|---|---|---|
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
