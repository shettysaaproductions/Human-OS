# KNOWN PATTERNS

# Startup Hydration Pattern

**Never:**
Return null forever.

**Always:**
Have a fail-safe timeout.

---

# FlatList Startup Pattern

**Never:**
`scrollToEnd` on first frame.

**Use:**
Render gating.

---

# Native Dependency Rule

Never publish an OTA that depends on a new native module.

Actions required:

1. Bump runtimeVersion.
2. Build new binary.
3. Install binary.
4. Publish OTA.
