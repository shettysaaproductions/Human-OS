# CURRENT HANDOFF

## Last Updated
2026-09-16 — v0.3.23-beta OTA: Voice Messages, Dual Modality & WhatsApp Audio Routing

## Session / Agent
Agent: MonkeyCode
Branch: `main`

## Status: OTA DEPLOYED (v0.3.23-beta) & VERIFIED

---

### Key Capabilities Delivered in v0.3.23-beta

1. **WhatsApp-Style Call Audio Routing**:
   - Seamless routing between `speaker`, `earpiece` (phone call style), and `bluetooth`.
   - Real-time Bluetooth hardware detection via `NativeAudioModule.getAvailableInputs()` polled every 2.5s during active calls.
   - WhatsApp-style Audio Output modal with live badge (`🔊 Speaker`, `📱 Earpiece`, `🎧 Bluetooth`).

2. **Dynamic Nova Voice Persona Switching**:
   - Users can switch voice personas (`Kore`, `Aoede`, `Charon`, `Fenrir`, `Puck`).
   - Mid-call persona switching seamlessly reconnects upstream Gemini Live WebSocket with the new voice while retaining transcript, timer, and duration.
   - Selected persona persists across app restarts via `SecureStore` (`nova_preferred_voice`).

3. **Chat Mic Button = Voice Message (NOT Live Call)**:
   - Header `📞` button remains the dedicated trigger for real-time live calls (`VoiceMode.tsx`).
   - Chat input bar `🎙️` button records voice notes directly in the chat screen.
   - Dedicated recording bar displays real-time recording timer (`🔴 Recording 00:05`), `✕ Cancel` button, and `↑ Send` button.
   - Audio is recorded via `expo-audio`, encoded to base64, and transmitted to `/api/chat`.

4. **Dual Modality Response & Unified Cognitive Pipeline**:
   - Voice messages are transcribed via `gemini-flash-latest` and processed through the exact same cognitive pipeline (`TurnAnalyzer`, deterministic memory, reminder detector, tool execution, DB persistence, Watchtower).
   - Nova responds with **both** spoken audio (`reply_audio_base64`, played via embedded Voice Note Player card) and full text transcript bubbles.
   - Audio player cards render with custom play/pause toggles and duration indicators for both user voice notes and Nova's replies.

---

### OTA / Deployment Record

| Version | Update Group ID | Android Update ID | iOS Update ID | Commit |
|---|---|---|---|---|
| v0.3.23-beta | 50bfb348-a660-4f9a-b868-c53392147af0 | 01a0a933-61b8-7fde-9ecc-8c12e650420b | 01a0a933-61b8-73a3-ba64-c3d308996501 | pending |
| v0.3.22-beta | 70445126-e3d9-4989-b519-b379dc1e4856 | 01a0a63a-6049-768d-9409-b4dc94591d4b | 01a0a63a-6049-710d-a84d-83cdf3350fbb | e5576ab |
| v0.3.21-beta | 1b2e26be-3074-4a77-9db1-c742cc3a935a | 01a0a5e2-0305-7149-90dc-6a4a125e55b9 | 01a0a5e2-0305-72ff-a842-baaac5b7bb44 | bda7f34 |
| v0.3.19-beta | d2f2b44a-96d9-4f93-b4cd-a4bfbf3a9817 | 01a0a3f7-b57a-74d3-8cbf-17936be9dbd7 | — | 65ceed6 |
| v0.3.16-beta | e3dd1dd5-f437-46f3-a0dc-6d942a9f2a67 | 01a0a057-b66e-7354-92e6-a4aa7268a51a | — | 324e69e |
| v0.3.15-beta | 48c6db6f-f465-4c7f-96a7-8b2632a50cd4 | 01a0a043-3693-7b91-9bca-8303b9471d8b | — | d34d8c1 |

---

### Files Modified This Session

| File | Change |
|---|---|
| `backend/src/routes/chat.ts` | Multi-modal audio transcription, voice note storage in `chat_history.meta`, dual-modality response synthesis & payload delivery |
| `backend/src/services/NovaVoiceService.ts` | `pcmToWav`, `synthesizeVoiceReply` via Gemini Live native audio, `transcribeAudio` via `gemini-flash-latest` |
| `mobile/src/hooks/useVoiceSession.ts` | WhatsApp audio routing (`speaker`/`earpiece`/`bluetooth`), dynamic Bluetooth detection, seamless voice switching reconnect & persistence |
| `mobile/src/components/VoiceMode.tsx` | Audio routing selector modal, active route badge, seamless persona switching |
| `mobile/src/screens/ChatScreen.tsx` | Voice recording input bar (`🔴 00:05`, Cancel, Send), Voice Note & Nova Reply Audio Player Cards with play/pause and progress |
| `mobile/src/store/useChatStore.ts` | Added audio properties to `Message` and pending queue, updated queue dispatcher |
| `mobile/src/services/chatService.ts` | `sendMessageAsync` signature extended with `audio_base64`, `audio_duration`, and `is_voice_message` |
| `mobile/src/config/updateHistory.json` | `v0.3.23-beta` release note entry at index 0 |

---

### NEXT ACTION
**Verify on Device**:
1. Launch app to load OTA update `v0.3.23-beta`.
2. Tap `🎙️` mic in chat: record voice message, test cancel, send.
3. Observe Nova's response: both Voice Player card and transcript text appear.
4. Tap `📞` in header to start live call: test Speaker / Earpiece / Bluetooth audio route toggling and voice persona changes.
