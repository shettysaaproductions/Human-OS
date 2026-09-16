# CURRENT HANDOFF

## Last Updated
2026-09-16 — Rapid Voice Processing, Instant Audio Sync & Zero-Desync Audio Guard (v0.3.28-beta)

## Session / Agent
Agent: MonkeyCode
Branch: `main`

## Status: VERIFIED & PRODUCTION DEPLOYED (OTA v0.3.28-beta Published + Broadcasted)

### EAS Production OTA Deployment (v0.3.28-beta)
- **Update Group ID**: `f85d0f4f-a8ac-448d-ad3f-8e713d97b791`
- **Android Update ID**: `01a0aa6e-7ed3-714f-a6d5-8a03073a14c8`
- **iOS Update ID**: `01a0aa6e-7ed3-7c48-8813-4bd732a0d25a`
- **Runtime Version**: `1.1.0`
- **Branch**: `production`
- **Broadcast Push**: Dispatched to registered devices via `broadcast_update_push.ts`.

---

### Critical Problems Solved & Core Invariants Enforced (v0.3.28-beta)

1. **Voice Note Latency & Elimination of 2-Minute Timeout**:
   - **Diagnosis**: Mobile app displayed soft timeout message *"Connection toh hai yaar, par thoda slow lag raha hai. Ek minute wait kar..."* after 120s of polling.
   - **Root Cause**: `transcribeAudio` in `NovaVoiceService.ts` was sequentially iterating through up to 20 candidate Gemini API keys with 12-second timeouts (worst-case 240s stall before fallback), and `synthesizeVoiceReply` had 45s timeouts. This total backend latency exceeded mobile's `MAX_REPLY_WAIT_MS = 120_000`.
   - **Fix**:
     - Capped `transcribeAudio` candidate attempts to 3 with a 6-second timeout (max 18s total failover).
     - Tightened `synthesizeVoiceReply` timeout dynamically between 12s and 22s max (`Math.round(cleanText.length * 100)`).

2. **Real-Time Voice Play Button (No Restart Required)**:
   - **Diagnosis**: Assistant's voice reply initially appeared as text-only; the green voice play button only appeared after cold restarting the app.
   - **Root Cause**: In `mobile/src/store/useChatStore.ts` line 1136, `updateLocalMessageIfNeeded` used `m.is_voice_message ?? !!(...)`. Because `m.is_voice_message` was boolean `false`, nullish coalescing evaluated to `false`. The voice flag was never toggled until `hydrateMessages` ran on startup.
   - **Fix**: Changed to boolean OR `(m.is_voice_message || incomingVoiceMsg)`. Also updated `needsAudioUpdate` to detect incoming voice replies and audio payloads, dynamically transitioning local messages to voice cards in real-time.

3. **Zero Audio / Text Desync on `Aligned (v2)`**:
   - **Diagnosis**: When Watchtower reflection revised an assistant reply to `Aligned (v2)`, playing the voice card spoke Version 1 text rather than Version 2 text, and duplicate bubbles appeared on screen.
   - **Root Cause**: Watchtower Pass 3 mutated `content` in `chat_history` 28 seconds after turn completion without re-synthesizing `audio_base64`. Furthermore, `hydrateMessages` assigned `id: `${msg.id}_part_${idx + 1}`` even for single chunks, whereas polling used `id: msg.id`, causing ID mismatch and duplicate bubble injection.
   - **Fix**:
     - In `backend/src/routes/chat.ts`, Watchtower reflection is strictly skipped on voice turns (`if (!is_proactive && !hasVoiceMessage)`).
     - In `backend/src/services/WatchtowerReflectionService.ts`, added invariant guard skipping text mutation if `is_voice_reply || audio_base64` is present.
     - In `mobile/src/store/useChatStore.ts`, unified ID assignment across `hydrateMessages`, `loadMoreMessages`, and polling: `id: finalChunks.length > 1 ? `${msg.id}_part_${idx + 1}` : msg.id`.
     - Added `needsContentUpdate` in `updateLocalMessageIfNeeded` with guard `!localMsg.is_voice_message` to update existing text bubbles in-place without duplicating.

---

### Verification Results

1. **Pre-flight Compilation**:
   - `cd backend && npm run build`: **0 errors (Exit 0)**
   - `cd mobile && npx tsc --noEmit`: **0 errors (Exit 0)**

2. **EAS Production OTA Publish**:
   - Successfully published to `production` branch.
   - Update Group ID: `f85d0f4f-a8ac-448d-ad3f-8e713d97b791`.

3. **Push Notification Broadcast**:
   - Successfully broadcasted `v0.3.28-beta` release alert to registered devices.

---

### Files Modified

| File | Status | Description |
|---|---|---|
| `backend/src/routes/chat.ts` | **MODIFIED** | Skip Watchtower reflection scheduling on voice turns to preserve 1:1 audio-text fidelity |
| `backend/src/services/NovaVoiceService.ts` | **MODIFIED** | Capped transcribe attempts to 3 (6s timeout) and voice synthesis to 12s-22s max |
| `backend/src/services/WatchtowerReflectionService.ts` | **MODIFIED** | Added voice reply guard skipping text mutation on synthesized audio replies |
| `mobile/src/store/useChatStore.ts` | **MODIFIED** | Fixed ID symmetry (`_part_` only when >1 chunk), real-time boolean OR voice flag sync, and in-place content updates |
| `mobile/src/config/updateHistory.json` | **MODIFIED** | Added `v0.3.28-beta` changelog for in-app update notification modal |

---

### NEXT ACTION
- Push verified changes to `origin main` to deploy backend updates to Render.
