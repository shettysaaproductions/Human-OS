# Next Sprint Priorities

## P1 (Critical/Immediate)
- **Faster startup:** Implement skeleton loaders during chat hydration, optimize auth flow, and reduce blocking tasks.
- **Background OTA improvements:** Refine silent updates to ensure users get the latest version seamlessly without interrupting UX.

## P2 (High Priority)
- **Remember language preference (Hindi):** Persist user's language selection locally so it is applied immediately on subsequent launches.
- **Better temporary memory:** Optimize how active chat context is stored and passed to the LLM backend to prevent prompt bloat.
- **Session summarization:** Periodically summarize historical context in the background to reduce active memory footprint while maintaining conversational continuity.

## P3 (Medium Priority)
- **Play Store launch:** Finalize the AAB build, complete store listing, provide privacy policies, and release on the Production track.
- **Analytics:** Implement robust telemetry for core user actions (app open, message sent) with batched requests.
- **Crash reporting:** Integrate an SDK (e.g., Sentry) to monitor JS exceptions, ANRs, and native crashes in production.
