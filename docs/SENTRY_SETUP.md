# Sentry Setup Guide

This guide describes how to configure and deploy [Sentry](https://sentry.io/) for crash reporting and monitoring in HumanOS.

## 1. Create a Sentry Project
1. Log in to [Sentry.io](https://sentry.io/).
2. Click **Create Project**.
3. Choose **React Native** as your platform.
4. Set the project name (e.g., `humanos-mobile`) and select your team.
5. Click **Create Project**.

## 2. Get your DSN
1. In your Sentry project, go to **Project Settings** > **Client Keys (DSN)**.
2. Copy the **DSN URL** (it looks like `https://xxx@sentry.io/xxx`).

## 3. Environment Variables
Add the DSN to the mobile project's `.env` file in the root directory:
```env
EXPO_PUBLIC_SENTRY_DSN="https://your-dsn-here@o0.ingest.sentry.io/0"
```

## 4. Production Setup & Release Tracking
Sentry automatically receives releases and mapping files if you use Expo Application Services (EAS).
Ensure your `app.json` has the `@sentry/react-native` plugin configured (this was automatically added during package installation).

## 5. OTA Compatibility
Because updates are published OTA via EAS:
- `runtimeVersion` is tracked to ensure OTA bundle compatibility.
- `updateId` is attached as a tag to each Sentry event to pinpoint which specific OTA build caused a crash.
- Filter issues in the Sentry Dashboard using the `updateId` tag.
