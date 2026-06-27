# Human OS - Task Execution Guide

## Overview
This guide provides the standard operating procedure for AI agents working on the Human OS repository.

## Execution Flow
1. **Initialization:** Read `README_SESSION_START.md` at the beginning of every session to establish full context before modifying any code.
2. **Planning:** For non-trivial tasks (architectural changes, feature additions), produce an implementation plan artifact and await user approval before executing.
3. **Model Selection:** Always start with the default model (Gemini 3.5 Flash Low) as per `MODEL_ROUTER.md`.
4. **Execution:** 
   - Keep heavy processing asynchronous (use the background queue/jobs table).
   - Maintain chat latency under 2 seconds.
   - Ensure all new subsystems include appropriate unit tests and diagnostics.
5. **Escalation:** If confidence drops below 80% or a debugging task hits a 30-minute block, persist the context and escalate to a stronger model (see Model Router rules).
6. **Logging:** Log model usage, token count, cost estimate, execution time, and outcome (success/failure) for each task.
7. **Delivery:** Commit every milestone separately and push to GitHub (if requested) upon completion.
