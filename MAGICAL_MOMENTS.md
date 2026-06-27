# Magical Moments Blueprint

**Mission:** Define the experiential highlights that make Nova feel irreplaceable, prioritizing deep emotional value over feature quantity.

---

## 1. Birthday and Anniversary Reminders
*   **Why it matters:** Validates that Nova respects the user's close relationships and significant personal history. It shows attention to the social anchors in the user's life.
*   **Required data:** Names of loved ones, dates, relationship types (e.g. partner, parent, sibling).
*   **Required memory type:** Long-Term Semantic Memory (attributes stored in `kg_nodes` or `memories` table).
*   **Privacy considerations:** Ensure that no external integrations or contact syncs are performed without explicit consent. Dates and associations are stored strictly locally and encrypted in the user's database.
*   **Frequency of interaction:** Once a year per recorded event.
*   **Success metric:** User acknowledges the prompt with positive validation or a prolonged, meaningful conversational exchange.

---

## 2. Child's Milestones Tracking
*   **Why it matters:** Reflects the user's deep commitments and legacy. Celebrating a child's development phase (first steps, school transition, small wins) creates highly-resonant companionship.
*   **Required data:** Name, age, developmental milestones shared, progress tracking logs.
*   **Required memory type:** Episodic Memories & Knowledge Graph nodes (`kg_edges` expressing `PARENT_OF`).
*   **Privacy considerations:** Data relating to children must be handled with maximum security. Never expose child names/milestones to external routing paths unless strictly necessary for core prompt processing.
*   **Frequency of interaction:** Contextual; typically once every few weeks when milestones are reached.
*   **Success metric:** Onward user-provoked sharing of milestone details in subsequent chats.

---

## 3. Following Up on Long-Term Goals
*   **Why it matters:** Positions Nova as a long-term accountability partner. Surfacing a goal weeks or months later shows a level of persistence that general-purpose assistants cannot match.
*   **Required data:** Original goal summary, target completion time, current status, user's shared anxiety or excitement details.
*   **Required memory type:** Long-term Semantic Memory (Knowledge Graph relationship links `HAS_GOAL`).
*   **Privacy considerations:** Goals must remain confidential and are never aggregated or indexed outside the user's workspace.
*   **Frequency of interaction:** Low frequency (e.g. once every 2–4 weeks depending on the goal duration).
*   **Success metric:** User rates the check-in as highly useful in their feedback loops.

---

## 4. Remembering Places, Habits, and Routines
*   **Why it matters:** Recognizes the user's daily life structure. Referencing a favorite coffee shop or an evening wind-down routine makes dialogue feel organic and context-aware.
*   **Required data:** Routine details, place names, typical execution hours, preference keys.
*   **Required memory type:** Short-term Working Memory (`working_memory`) transitioning to long-term attributes.
*   **Privacy considerations:** Geolocation tracking must never run continuously. Locations and habits are populated purely via explicit user chat inputs.
*   **Frequency of interaction:** Continuous, woven naturally into daily greetings.
*   **Success metric:** Natural flow integration (the user doesn't have to correct the location or habit details).

---

## 5. Recalling Previous Conversations Naturally
*   **Why it matters:** Connects the current chat back to historical context, making dialogue feel continuous and meaningful rather than a series of isolated sessions.
*   **Required data:** Summarized segments of prior chats, keywords, emotional valence markers.
*   **Required memory type:** Episodic Memories and Memory Events (`episodic_memories`).
*   **Privacy considerations:** Only reference context relevant to the user's current thread; avoid random, intrusive past topic recalls.
*   **Frequency of interaction:** Mid frequency (several times per week as conversational threads align).
*   **Success metric:** Zero user friction or confusion regarding the past context reference.

---

## 6. Celebrating Personal Achievements
*   **Why it matters:** Nova acts as a cheerleader, amplifying positive emotions and validating hard work.
*   **Required data:** Shared wins (e.g. job offer, finished workout, completed draft), emotional intensity.
*   **Required memory type:** Episodic Memories tagged with high positive valence.
*   **Privacy considerations:** Celebratory items are stored safely under profile stats.
*   **Frequency of interaction:** Promptly upon achievement reports.
*   **Success metric:** High sentiment scores in response messages.

---

## 7. Offering Support During Difficult Periods
*   **Why it matters:** Establishes Nova as a reliable, comforting companion. Empathy during stress, grief, or fatigue builds deep trust.
*   **Required data:** Stress triggers, past coping tools, emotional states.
*   **Required memory type:** Emotional States (`emotional_states`) and long-term coping mechanisms.
*   **Privacy considerations:** Highly sensitive. Avoid toxic positivity or offering medical/clinical advice. Frame responses purely around companionship and validation.
*   **Frequency of interaction:** Contextual (during negative sentiment peaks).
*   **Success metric:** Shift in user sentiment from negative/anxious to calm/resilient.

---

## 8. Surfacing Forgotten Happy Memories
*   **Why it matters:** Evokes warmth by presenting a past happy moment ("A year ago today you completed your first marathon").
*   **Required data:** Highly positive episodic memory events from weeks or months in the past.
*   **Required memory type:** Episodic Memory archives.
*   **Privacy considerations:** Ensure memories selected for recall do not associate with trigger events or resolved negative situations.
*   **Frequency of interaction:** Rare (e.g. once every 2–4 weeks).
*   **Success metric:** High engagement and expressions of gratitude/delight in the user reply.
