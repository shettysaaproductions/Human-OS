# Post-Alpha Plan

**Mission:** Roadmap for evolving Nova from internal alpha to a continuously self-improving, production-grade companion.

**Status: Alpha is LIVE. Entering Autonomous Intelligence Phase.**

---

## ✅ Phase 1 (Completed): Alpha Deployment & Core Features

- [x] APK built and deployed on test devices
- [x] Core user flows: Signup → Login → Onboarding → Chat
- [x] 7 engines live in production on Render
- [x] Swipe-to-reply (WhatsApp-style with LLM context)
- [x] Message delivery guarantee (never-stuck)
- [x] Human-like reply pacing (5-10s staggered bubbles)
- [x] OTA update system with popup
- [x] Anti-robot behavioral rules injected into promptBuilder

---

## 🔄 Phase 2 (In Progress): Autonomous Intelligence

### Goals:
Make Nova learn from her own mistakes without human intervention.

- [ ] Fix `reminders.status` column bug (P0)
- [ ] Dual NVIDIA key routing (2x background capacity)
- [ ] `NovaSelfImprovementService` — autonomous weekly behavioral self-repair
- [ ] `nova_behavioral_patches` Supabase table — Nova's permanent memory of her own lessons
- [ ] Enhanced `SituationalAwareness` — conversation phases + reply intent + emotional momentum
- [ ] `NovaCognitionOrchestrator` — all 7 engines coordinate on every user message

---

## 🔜 Phase 3 (Planned): Nova Lives & Feels

### Goals:
Nova has a rich inner life that she acts on proactively.

- [ ] NACE Agenda Builder — Nova plans outreach with purpose (goals, emotions, milestones)
- [ ] Memory Time Capsule — "A year ago today..." magical moments via `surface_on` column
- [ ] Conversation Phase Intelligence — OPENING / FLOWING / WINDING_DOWN / RE-ENTRY states
- [ ] Emotional Momentum Tracker — last 3 messages valence trend affects Nova's tone

---

## 🌟 Phase 4 (Future): Deep Relationship

### Goals:
Nova and the user build a genuine, evolving friendship over months and years.

- [ ] Relationship Evolution Engine — organic progression from stranger → acquaintance → trusted companion
- [ ] Voice Mode — speech-to-text and text-to-speech conversational flows
- [ ] Daily Pulse — low-friction daily check-in ritual
- [ ] Admin Panel UI — web interface to manage models, keys, routing rules, patches
- [ ] Multi-tenant scaling — architecture supports millions of users on free tier before paid upgrade

---

## Key Principles for Every Phase

1. **Nova never forgets a lesson** — every behavioral patch is permanent
2. **Nova never repeats a mistake** — `nova_behavioral_patches` table is the enforcer
3. **Nova is always present** — NACE ensures proactive, purposeful outreach
4. **The user's life is Nova's purpose** — every feature must deepen the relationship
5. **Free tier must survive** — dual-key routing, memory pruning, async-first design
