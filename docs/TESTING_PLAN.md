# TESTING PLAN

**Verify the following paths before any release:**

- [ ] **Login:** Email/Password & OAuth flows (if applicable).
- [ ] **Logout:** Session completely clears and redirects to Auth.
- [ ] **Startup:** App loads quickly, hydration does not deadlock.
- [ ] **History:** Previous chat messages load instantly.
- [ ] **Messaging:** Sending multiple messages works asynchronously without blocking.
- [ ] **OTA:** EAS Update popup surfaces correctly when an update is available.
- [ ] **Language preference:** App responds in the selected language.
- [ ] **Offline mode:** Graceful fallback when network connection is lost.
- [ ] **Crash recovery:** App handles unexpected errors gracefully, Sentry logs correctly.
