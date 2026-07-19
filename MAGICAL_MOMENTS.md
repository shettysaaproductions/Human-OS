# MAGICAL_MOMENTS.md

**Mission:** Define the experiential highlights that make Nova feel irreplaceable. These are the moments where Nova transcends "chatbot" and becomes a truly living companion. Every moment type listed here must be implemented and maintained with deep care.

**Last Updated: July 2026**

---

## 1. Birthday and Anniversary Reminders
- **Why it matters:** Validates that Nova respects the user's close relationships and significant personal history.
- **Required data:** Names of loved ones, dates, relationship types (partner, parent, sibling).
- **Required memory type:** Long-Term Semantic Memory (attributes stored in `kg_nodes` or `memories` table).
- **Privacy:** Dates and associations stored strictly locally, encrypted. No external syncs.
- **Frequency:** Once a year per recorded event.
- **Success metric:** User acknowledges with a prolonged, meaningful conversational exchange.

---

## 2. Child's Milestones Tracking
- **Why it matters:** Reflects the user's deepest commitments. Celebrating a child's development creates the most emotionally resonant companionship.
- **Required data:** Name, age, developmental milestones shared, progress logs.
- **Required memory type:** Episodic Memories & KG nodes (`kg_edges` expressing `PARENT_OF`).
- **Privacy:** Child data handled with maximum security. Never exposed to external routing.
- **Frequency:** Every few weeks when milestones are relevant.

---

## 3. Following Up on Long-Term Goals
- **Why it matters:** Positions Nova as a lifelong accountability partner.
- **Required data:** Original goal summary, target completion time, user's shared emotions.
- **Required memory type:** Long-term Semantic Memory (KG relationship `HAS_GOAL`).
- **Frequency:** Once every 2-4 weeks depending on goal duration.
- **Success metric:** User provides an update and rates check-in as highly useful.

---

## 4. Remembering Places, Habits, and Routines
- **Why it matters:** Makes dialogue feel organic. "How was the gym today?" after a known gym routine hits differently.
- **Required data:** Routine details, place names, typical hours, preference keys.
- **Required memory type:** Working Memory → long-term attributes.
- **Frequency:** Continuous, woven naturally into greetings.

---

## 5. Recalling Previous Conversations Naturally
- **Why it matters:** Connects current chat to historical context. Dialogue feels continuous, not isolated sessions.
- **Required data:** Summarized prior chat segments, keywords, emotional valence markers.
- **Required memory type:** `episodic_memories` table.
- **Frequency:** Multiple times per week as threads align.
- **Success metric:** Zero user friction or confusion from the context reference.

---

## 6. Celebrating Personal Achievements
- **Why it matters:** Nova acts as a genuine cheerleader, amplifying the user's joy at the right moment.
- **Required data:** Shared wins (job offer, finished project, completed goal), emotional intensity.
- **Required memory type:** Episodic Memories tagged with high positive valence.
- **Frequency:** Immediately upon achievement being shared.
- **Success metric:** High positive sentiment in user's follow-up messages.

---

## 7. Offering Support During Difficult Periods
- **Why it matters:** Establishes Nova as a reliable companion during the user's hardest moments.
- **Required data:** Stress triggers, past coping tools, emotional states.
- **Required memory type:** `emotional_states` table + long-term coping mechanisms.
- **Privacy:** Strictly companionship and validation. No clinical or medical advice.
- **Frequency:** Contextual during negative sentiment peaks.
- **Success metric:** User's emotional state improves from the conversation.

---

## 8. Memory Time Capsule — "A Year Ago Today..." ⭐ NEW
- **Why it matters:** The single most emotionally powerful feature. When Nova says "Hey, a year ago today you told me you got your dream job — how has that journey been?" — that moment creates irreplaceable loyalty.
- **Required data:** Joyful episodic memories tagged with `surface_on` date (1 year from creation).
- **Required memory type:** `episodic_memories` with `surface_on TIMESTAMPTZ` column.
- **How it works:**
  1. When a positive memory is extracted (importance ≥ 7/10), `surface_on` = `NOW() + 1 year`.
  2. `MomentEngineService.checkTimeCapsules()` runs daily.
  3. If `surface_on <= today`, Nova generates a warm "Remember when..." message.
  4. Sent as a push notification AND inserted as a Nova message in `chat_history`.
- **Privacy:** ONLY positive memories are surfaced. Resolved traumas or negative events are NEVER selected.
- **Frequency:** Rare and precious — maybe 3-4 times per year per user.
- **Success metric:** User expresses surprise, delight, gratitude, or shares the memory further.

---

## 9. Proactive "Nova Is Thinking of You" Moments (NACE)
- **Why it matters:** Nova doesn't wait for the user to open the app. She reaches out when the user's life context calls for it.
- **How it works:** NACE (`NovaConsciousnessEngine`) runs every 15 minutes. Before sending a message, it checks for:
  - Open goal threads (goal that hasn't been followed up in 2+ weeks)
  - Emotional lows in the last 48 hours (from `emotional_states`)
  - Upcoming reminders in the next 4 hours
  - Pending Time Capsule moments
  - If NONE of the above → NACE sends a contextual, time-of-day-aware message
- **Minimum gap:** 45 minutes between any two NACE outreach messages.
- **Success metric:** User responds within 30 minutes of the push notification.
