# GEMINI TASK: Relationship Dashboard — Stats & Milestones

## Role
You are a Senior Mobile Engineer for HumanOS.
Stack: React Native (Expo) + TypeScript + Supabase.

## Goal
Add a "Relationship Dashboard" tab in the app showing:
- Days together with Nova
- Total messages exchanged
- Memories created
- Current streak (days in a row chatted)
- Upcoming milestones

## Step 1: Backend Route

Create `backend/src/routes/relationship.ts`:

```typescript
import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticateUser } from '../middleware/auth';

export const relationshipRouter = Router();

relationshipRouter.get('/stats', authenticateUser, async (req, res) => {
  const userId = (req as any).user.id;
  
  const [
    { count: totalMessages },
    { count: totalMemories },
    { data: firstMessage },
    { data: profile }
  ] = await Promise.all([
    supabaseAdmin.from('chat_history').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    supabaseAdmin.from('memories').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    supabaseAdmin.from('chat_history').select('created_at').eq('user_id', userId).order('created_at', { ascending: true }).limit(1),
    supabaseAdmin.from('profiles').select('preferred_name').eq('id', userId).maybeSingle()
  ]);

  const firstDate = firstMessage?.[0]?.created_at ? new Date(firstMessage[0].created_at) : new Date();
  const daysTogetherMs = Date.now() - firstDate.getTime();
  const daysTogether = Math.floor(daysTogetherMs / (1000 * 60 * 60 * 24));

  // Milestones
  const milestones = [10, 50, 100, 500, 1000, 5000, 10000];
  const nextMilestone = milestones.find(m => m > (totalMessages || 0)) || null;

  res.json({
    daysTogether,
    totalMessages: totalMessages || 0,
    totalMemories: totalMemories || 0,
    nextMilestone,
    userName: profile?.preferred_name || 'Friend',
    firstConversationDate: firstDate.toISOString()
  });
});
```

Register in `backend/src/app.ts`:
```typescript
import { relationshipRouter } from './routes/relationship';
app.use('/relationship', authenticateUser, relationshipRouter);
```

## Step 2: Mobile Screen

Create `mobile/src/screens/RelationshipScreen.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { api } from '../services/api';

interface Stats {
  daysTogether: number;
  totalMessages: number;
  totalMemories: number;
  nextMilestone: number | null;
  userName: string;
}

export function RelationshipScreen() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/relationship/stats')
      .then(r => setStats(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <ActivityIndicator style={{ flex: 1 }} />;
  if (!stats) return <Text>Could not load stats.</Text>;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>You & Nova</Text>
      <Text style={styles.subtitle}>Your journey together</Text>

      <View style={styles.card}>
        <Text style={styles.statNumber}>{stats.daysTogether}</Text>
        <Text style={styles.statLabel}>Days Together</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.statNumber}>{stats.totalMessages.toLocaleString()}</Text>
        <Text style={styles.statLabel}>Messages Exchanged</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.statNumber}>{stats.totalMemories.toLocaleString()}</Text>
        <Text style={styles.statLabel}>Memories Created</Text>
      </View>

      {stats.nextMilestone && (
        <View style={styles.milestoneCard}>
          <Text style={styles.milestoneText}>
            🎯 Next milestone: {stats.nextMilestone} messages
            ({stats.nextMilestone - stats.totalMessages} to go!)
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f', padding: 20 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginTop: 40 },
  subtitle: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 30 },
  card: { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 24, marginBottom: 16, alignItems: 'center' },
  statNumber: { fontSize: 48, fontWeight: 'bold', color: '#7c3aed' },
  statLabel: { fontSize: 14, color: '#aaa', marginTop: 4 },
  milestoneCard: { backgroundColor: '#1e1b4b', borderRadius: 16, padding: 20, marginBottom: 16 },
  milestoneText: { color: '#a5b4fc', fontSize: 14, textAlign: 'center' }
});
```

## Step 3: Add To Navigation

In `mobile/src/navigation/`, add RelationshipScreen to the tab navigator.
Add a heart icon tab for it.

## Verification
1. `npx tsc --noEmit`
2. Navigate to the Relationship tab — stats load correctly
3. Stats match what's in Supabase

## Deploy
```bash
git add backend/src/routes/relationship.ts backend/src/app.ts mobile/src/screens/RelationshipScreen.tsx
git commit -m "feat: Relationship Dashboard with stats and milestones"

cd mobile
eas update --branch production --message "feat: Relationship Dashboard" --environment production --non-interactive
```
