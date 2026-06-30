# PLAY STORE DATA SAFETY

*Use this document as a reference when filling out the Google Play Console Data Safety Form.*

## Data Collection & Security
- **Is data encrypted in transit?** Yes (HTTPS/TLS for all API and Supabase communication).
- **Can users request data deletion?** Yes, via the in-app settings or email.
- **Is data shared with third parties?** Yes (AI service providers process chat queries; Crash logs sent to monitoring services).

## Data Types Collected

### 1. Personal Info
- **Email Address:** Collected for authentication. (Required)

### 2. App Activity
- **User Interactions (Chat Logs):** Collected to provide the core AI companion functionality. (Required)

### 3. App Info and Performance
- **Crash Logs:** Collected for diagnostics and stability improvements. (Optional/Required depending on user opt-in)
- **Diagnostics:** General app performance data. (Optional)

### 4. Device or Other IDs
- **Device IDs:** Collected for push notifications and unique crash log tracing. (Optional)
