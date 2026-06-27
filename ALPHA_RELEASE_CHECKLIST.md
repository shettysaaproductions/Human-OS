# Alpha Release Checklist

This document details the diagnostic steps and exit criteria required to release Human OS to a stable internal alpha stage (`v0.1.0-alpha`).

---

## 1. Quality & Functionality Checklist

### Authentication
- [ ] Signup flow is fully operational.
- [ ] Login flow returns valid session tokens.
- [ ] Logout invalidates sessions on both mobile client and server.
- [ ] Token refresh routines verify and reload sessions without manual login.

### Onboarding
- [ ] All 6 onboarding questions submit correctly from the UI.
- [ ] Onboarding process runs cleanly to completion without backend or app crashes.
- [ ] User profile updates (`onboarding_completed: true` and name/personality seeds) are saved to database.

### Chat Engine
- [ ] Message payloads send and receive successfully.
- [ ] Message history loads chronologically upon opening a conversation.
- [ ] Failed messages trigger retry options.
- [ ] Offline status behaves gracefully (queues locally, notifies user).

### Cognitive Memory
- [ ] Semantic memories are generated post-onboarding.
- [ ] Vector and text-based memory retrievals return correct context.
- [ ] Deduping logic prevents duplicate vector memory insertions.
- [ ] Asynchronous queue workers (`QueueService`) process extraction tasks cleanly.

### Diagnostics & Admin
- [ ] Queue metrics and latency reports run successfully.
- [ ] Dynamic encryption decodes API keys properly at runtime.
- [ ] Settings TTL cache respects the 60-second expiration.

### Infrastructure & Pipeline
- [ ] `npm run doctor` diagnostics check passes cleanly.
- [ ] `npm run build` completes with zero TypeScript compilation warnings or errors.
- [ ] Staging and production branches build and deploy cleanly to Render.
- [ ] Active Supabase schemas are fully synchronized with the local migrations list.

---

## 2. Release Exit Criteria

*   **User Stability:** 5 to 10 testers can actively converse with Nova daily for 7 consecutive days with zero crashes.
*   **Performance:** 90% of chat responses resolve within 2.0 seconds.

---

## 3. Alpha Deliverables Checklist
- [ ] **`ALPHA_STATUS.md`**: Live verification status of each test parameter.
- [ ] **`Known Issues List`**: Mapped bugs and temporary workarounds.
- [ ] **`Release Notes`**: Outlines features added, instructions, and migration steps.

---

## 4. Release Tagging
Upon successful exit completion:
```bash
git tag -a v0.1.0-alpha -m "Initial internal stable alpha release"
git push origin v0.1.0-alpha
```
