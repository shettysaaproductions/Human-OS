# HumanOS Specific Agent Rules

## The "Auto Upgrade" Protocol
When the user types `"auto upgrade"`, `"upgrade"`, or requests a conversational skills upgrade:
1. You must immediately run the `fetch_recent_chats.ts` script located in `backend/scripts/fetch_recent_chats.ts` to pull the latest chat logs from the Supabase database.
2. Carefully analyze the chat logs (especially the AI's responses and the `TELEMETRY META` data) for any of the following issues:
   - **Echoing**: Repeating what the user just said instead of reacting naturally.
   - **Robotic Tone**: Asking too many interrogative questions (e.g. "kya plan hai?", "aur kya karoge?").
   - **Formality**: Using formal Hindi or words like "Aap" instead of "Tum" or "Tu".
   - **Hallucinations**: Time skips, memory failures, or failing to understand the present context.
3. **Implementation Plan**: Before making code changes, always create an `implementation_plan.md` artifact. This plan must thoroughly analyze the detected flaws and map out exactly how to fix them by deeply understanding all aspects of the chat interface (including time context, message status, reply intent, etc.).
4. Once the flaws are identified and the plan is clear, automatically modify `backend/src/services/promptBuilder.ts` (or other relevant AI engines) to patch the behavior with strict anti-robot rules.
5. Restart the local backend to apply the changes.
6. Push the changes to GitHub (`git add .`, `git commit -m "Auto Upgrade: <brief description>"`, `git push origin main`) to trigger the cloud backend deployment.
7. If any mobile frontend files were modified, run an Over-The-Air (OTA) update by navigating to the `mobile` directory and running `npx eas update --auto`.
8. Present the user with a summary of exactly what psychological/behavioral flaws were found, how the core prompt was patched, and confirm that the updates have been pushed OTA and to the cloud.
