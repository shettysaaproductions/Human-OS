# Build Report — Nova Human OS

**Date:** 2026-06-28  
**Prepared by:** Antigravity  
**Platform:** Android  
**Build Profile:** `apk` (sideloading)  
**EAS Project:** `shettysaa/mobile`

---

## 1. Is a New APK Required?

**YES — a new native APK build is required.**

The app was previously running on **Expo Go**, which ships a fixed set of pre-built native modules. Since the Beta Foundation Sprint and Beta Polish Sprint, multiple native libraries were added that are **not included in Expo Go's bundle**.

---

## 2. Native Libraries Added — Expo Go Incompatible

The following packages contain native code and **will crash or silently fail in Expo Go**:

| Library | Version | Why Native | Added In |
|---|---|---|---|
| `@shopify/react-native-skia` | `2.6.2` | C++ GPU rendering engine | Beta Foundation Sprint |
| `react-native-reanimated` | `4.3.1` | JS → UI thread bridge (native worklets) | Beta Foundation Sprint |
| `react-native-graph` | `1.2.0` | Uses Skia + Reanimated natively | Beta Foundation Sprint |
| `react-native-svg` | `15.15.4` | Native SVG renderer | Beta Foundation Sprint |
| `react-native-gesture-handler` | `~2.31.1` | Native touch event system | Beta Foundation Sprint |
| `react-native-gifted-charts` | `1.4.77` | SVG charts (depends on react-native-svg) | Beta Foundation Sprint |
| `expo-updates` | `~56.0.19` | OTA update native module | Original build (required plugin) |

**Pure JS packages (safe in Expo Go):**
- `@react-navigation/bottom-tabs` — JS only
- `d3-force`, `d3-scale`, `d3-shape` — pure JS
- `axios`, `zustand` — pure JS

---

## 3. Issues Found & Fixed Before APK Build

### Issue 1: Duplicate lock file (expo-doctor ✖)
- `pnpm-lock.yaml` existed alongside `package-lock.json`
- **Fix:** Deleted `pnpm-lock.yaml` — EAS Build uses npm

### Issue 2: Missing peer dependency (expo-doctor ✖)
- `react-native-worklets` was missing (required by `react-native-reanimated` v4 + `react-native-graph`)
- **Fix:** `npx expo install react-native-worklets`

### Issue 3: `react-native-gesture-handler` version mismatch (expo-doctor ✖)
- Found: `3.0.2` — Expected by Expo SDK 56: `~2.31.1`
- **Fix:** `npx expo install react-native-gesture-handler@"~2.31.1"`

### Issue 4: `app.json` missing `updates.enabled: true`
- OTA updates were configured but not explicitly enabled
- **Fix:** Added `"enabled": true` to `updates` block

### Issue 5: Broken `react-native-reanimated` plugin reference in `app.json`
- Reanimated v4 does **not** ship an `app.plugin.js` — causes `expo install` to error with "Config plugins are typically exported from an app.plugin.js file"
- **Fix:** Removed `"react-native-reanimated"` from `plugins[]` in `app.json`

### Issue 6: iOS `deploymentTarget` too low
- Set to `15.1`, but `expo-build-properties` requires minimum `16.4` for SDK 56
- **Fix:** Updated to `"deploymentTarget": "16.4"`

### Issue 7: `@react-navigation/bottom-tabs` in devDependencies
- Was listed under `devDependencies` — excluded from production bundle
- **Fix:** Moved to `dependencies` via `npx expo install @react-navigation/bottom-tabs`

### Issue 8: `expo-build-properties` missing
- Referenced in `app.json` plugins but not installed
- **Fix:** `npx expo install expo-build-properties`

---

## 4. app.json OTA Configuration — Final State

```json
"updates": {
  "url": "https://u.expo.dev/17e73685-4785-47b5-8302-82d1df185f8c",
  "enabled": true,
  "fallbackToCacheTimeout": 0,
  "checkAutomatically": "ON_LOAD"
},
"runtimeVersion": {
  "policy": "appVersion"
}
```

✅ `enabled: true` — OTA updates active  
✅ `checkAutomatically: ON_LOAD` — checks every time the app opens  
✅ `runtimeVersion.policy: appVersion` — new native build required for version bumps only  
✅ OTA updates are compatible as long as `version` in `package.json` stays `1.0.0`

---

## 5. eas.json Build Profiles — Final State

| Profile | Output | Channel | Use Case |
|---|---|---|---|
| `development` | Dev client | development | Local debugging with dev menu |
| `preview` | APK | preview | Internal testing, sideloading |
| `apk` | **APK** | **production** | **Sideloading on production channel** |
| `production` | AAB | production | Play Store submission |

**Current build:** `apk` profile → produces `.apk` downloadable from EAS, signed with production channel → **receives OTA updates from `eas update --branch production`**

---

## 6. OTA Compatibility After Rebuild

After the new APK is installed:

| Update Type | Compatible? | Notes |
|---|---|---|
| JS-only changes | ✅ YES | Delivered via `eas update --branch production` |
| New native packages | ❌ NO | Requires new APK build |
| `app.json` plugin changes | ❌ NO | Requires new APK build |
| UI text, styles, logic | ✅ YES | Full OTA compatibility |
| New screens (pure React) | ✅ YES | Delivered instantly via OTA |

**Future rule:** Any time a package with `"android"` or `"ios"` entries in its `package.json`, or an `app.plugin.js`, is added — a new APK build is required.

---

## 7. Build Command Reference

```bash
# Sideloadable APK (production channel)
eas build --platform android --profile apk

# Internal test APK (preview channel)
eas build --platform android --profile preview

# Production AAB for Play Store
eas build --platform android --profile production

# Push JS-only OTA update after APK is installed
npm run update:production
# or: eas update --branch production --message "..."
```

---

## 8. Post-Install Verification Checklist

After installing the new APK:

- [ ] App launches without white screen crash
- [ ] Chat screen loads and dark theme is visible
- [ ] `🧠` Brain Dashboard opens
- [ ] Memory Brain renders category cards and heatmap (Skia)
- [ ] Emotional Brain renders weekly bar graph (Skia)
- [ ] Knowledge Graph Explorer renders force-directed nodes (Skia + d3)
- [ ] Goal Brain renders progress rings
- [ ] Life Timeline renders events
- [ ] Founder Dashboard loads with pull-to-refresh
- [ ] Beta Observatory loads with all 5 tabs
- [ ] `⚙️` Settings screen opens
- [ ] Feedback screen opens and submits
- [ ] OTA update check fires on next launch (check EAS dashboard for delivery)

---

## 9. Build Status

| Step | Status |
|---|---|
| `expo-doctor` issues fixed | ✅ All 3 resolved |
| `app.json` updates.enabled | ✅ Added |
| `pnpm-lock.yaml` removed | ✅ Deleted |
| `react-native-gesture-handler` version | ✅ Fixed to ~2.31.1 |
| `expo-build-properties` installed | ✅ Installed |
| `@react-navigation/bottom-tabs` → deps | ✅ Moved |
| `react-native-worklets` installed | ✅ Installed |
| `git push` | ✅ `500a2c1 → main` |
| `eas build --platform android --profile apk` | 🔄 **In Progress on EAS servers** |
