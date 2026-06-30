# HumanOS — Engineering Roadmap
> Last Updated: 2026-06-30

---

## Legend
- 🔴 P0 — Production broken
- 🟠 P1 — Significant UX degradation
- 🟡 P2 — Performance / quality
- 🟢 Feature — New capability

---

## Completed

| Item | Priority | OTA |
|---|---|---|
| Fix startup chat scroll jump | P0 | 46c2969e |
| Hide dev diagnostics from production users | P0 | 46c2969e |
| Restore timestamps on messages | P0 | 46c2969e |
| Restore floating date separator header | P0 | 46c2969e |
| Restore multiple message queuing | P0 | 46c2969e |
| Remove blocking OTA update screen | P1 | a9b98ce0 |
| Background OTA check (non-blocking) | P1 | a9b98ce0 |
| Performance quick wins (console.log removal, FlatList tuning, stickyDate bail-out) | P2 | Pending |

---

## In Progress

| Item | Priority | ETA |
|---|---|---|
| Performance quick wins OTA | P2 | Today |

---

## Upcoming — P1

| Item | Description |
|---|---|
| Skeleton loader during hydration | Replace ActivityIndicator with Skeleton while chat history loads |
| Stale-while-revalidate for messages | Show cached messages instantly, update from network in background |

---

## Upcoming — P2

| Item | Description |
|---|---|
| Windowed message loading | Cap hydrated messages to 100, paginate older on scroll-up |
| Fix renderItem messages closure | Use useRef to avoid re-creating renderItem on every new message |
| Pre-compute date separators | useMemo to compute showDateSeparator array outside renderItem |
| Telemetry batching | Batch trackEvent calls with 5s flush to reduce network requests |
| Skeleton components | Use existing Skeleton.tsx across all loading states |

---

## Upcoming — Features

| Item | Description | Priority |
|---|---|---|
| Memory/brain visualization | UI to show user's stored memories | Feature |
| Push notifications | Notify user of Nova replies | Feature |
| Voice input | Record and transcribe messages | Feature |
| Message search | Search through conversation history | Feature |
| Export chat history | Download conversation as PDF/text | Feature |

---

## Engineering Constraints

- **Never touch without manual cold-start verification:** `hydrateMessages`, `conversationId`, `isHydrated`, pagination, auth flow.
- **Always typecheck before OTA:** `npx tsc --noEmit`
- **Always run on feature branch:** never commit directly to `feature-recover-ui` without review.
- **EAS publish command:** `eas update --branch production --environment production --message "..."`
