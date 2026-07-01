# GEMINI TASK: Nova Personality System

## Role
You are a Senior Full-Stack Engineer for HumanOS.
Stack: React Native (Expo) + Express + Supabase + TypeScript.

## Goal
Let users choose Nova's personality. This changes how Nova speaks —
not what Nova knows. Personality is stored in the user's profile and injected into
the system prompt on every chat request.

## Personalities

| Key | Name | Description |
|-----|------|-------------|
| `friendly` | Friendly (Default) | Warm, casual, supportive |
| `professional` | Professional | Formal, concise, business-like |
| `coach` | Life Coach | Motivational, action-oriented, goal-focused |
| `creative` | Creative | Expressive, playful, storytelling |
| `motivational` | Motivational | Energetic, enthusiastic, inspiring |

## Step 1: Supabase — Add Column

```sql
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS nova_personality text DEFAULT 'friendly'
CHECK (nova_personality IN ('friendly', 'professional', 'coach', 'creative', 'motivational'));
```

## Step 2: Backend — Update Prompt Builder

In `backend/src/routes/chat.ts`, find where the profile is loaded:

```typescript
const { data: profileData } = await supabaseAdmin
  .from('profiles')
  .select('preferred_name, companion_personality')
  .eq('id', userId)
  .maybeSingle()
```

Change to also select `nova_personality`:
```typescript
.select('preferred_name, companion_personality, nova_personality')
```

Then define personality prompts:

```typescript
const PERSONALITY_PROMPTS: Record<string, string> = {
  friendly: 'You are warm, curious, casual, and supportive. Like a best friend who genuinely cares.',
  professional: 'You are formal, concise, and professional. Give structured answers. No emojis.',
  coach: 'You are a motivational life coach. Push the user toward their goals. Ask powerful questions. End with an action step.',
  creative: 'You are expressive and creative. Use vivid language, metaphors, and storytelling. Make conversations memorable.',
  motivational: 'You are high-energy and enthusiastic. Celebrate the user\'s wins. Inspire them to take action.'
};

const personalityKey = profile?.nova_personality || 'friendly';
const personalityPrompt = PERSONALITY_PROMPTS[personalityKey] || PERSONALITY_PROMPTS.friendly;
```

Inject into the system prompt:
```typescript
const systemPrompt = `You are Nova, a personal AI companion for ${profile?.preferred_name || 'the user'}.
${personalityPrompt}
Never say "As an AI". Never break character.`;
```

## Step 3: Mobile — Settings UI

In `mobile/src/screens/PreferencesScreen.tsx`, add a personality picker section:

```tsx
const PERSONALITIES = [
  { key: 'friendly', label: '😊 Friendly', desc: 'Warm and supportive' },
  { key: 'professional', label: '💼 Professional', desc: 'Formal and concise' },
  { key: 'coach', label: '🎯 Life Coach', desc: 'Goal-focused and motivational' },
  { key: 'creative', label: '🎨 Creative', desc: 'Expressive and playful' },
  { key: 'motivational', label: '🔥 Motivational', desc: 'High energy and inspiring' },
];
```

Add a `TouchableOpacity` for each, highlighting the selected one.
On selection, call `api.patch('/onboarding/profile', { nova_personality: key })`.

## Step 4: Backend — Patch Route

In `backend/src/routes/onboarding.ts`, ensure `nova_personality` is accepted
in the profile update endpoint. If there's a `PATCH /profile` or `POST /profile` route,
add `nova_personality` to the allowed fields.

## Verification
1. `npx tsc --noEmit` — no errors
2. Change personality in the app
3. Send a message — Nova's tone should noticeably change
4. Check Supabase profiles table — `nova_personality` should be updated

## Deploy
```bash
git add backend/src/routes/chat.ts backend/src/routes/onboarding.ts mobile/src/screens/PreferencesScreen.tsx
git commit -m "feat: Nova personality system — 5 selectable companion personalities"
git push origin feature-performance-phase1

cd mobile
eas update --branch production --message "feat: Nova personality system" --environment production --non-interactive
```
