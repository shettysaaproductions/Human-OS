import { supabaseAdmin } from '../lib/supabase';
import { invalidateAnalyticsCache } from '../routes/analytics';

async function main() {
  const userId = '62f9190b-1e1d-48d5-9667-12cd0bc3114b';
  console.log(`=== RESTORING USER MEMORIES FOR ${userId} ===`);

  // 1. Un-archive legitimate memories that were mistakenly marked INVALIDATED / archived
  const legitKeysToUnarchive = [
    'entity:user:location',
    'entity:user:favorite_tea',
    'entity:user:favorite_food',
    'entity:user:food_preference',
    'entity:user:hobby',
    'career_milestone_mtv_hustle',
    'user_drinking_habit',
    'sakshi_home_celebrations',
    'ganpati_festival',
    'entity:suresh:details'
  ];

  console.log('Un-archiving valid memories...');
  for (const k of legitKeysToUnarchive) {
    const { error } = await supabaseAdmin
      .from('memories')
      .update({ is_archived: false, lifecycle_state: 'CURRENT', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('key', k);
    if (error) console.error(`Error unarchiving ${k}:`, error.message);
  }

  // 2. Canonical list of memories matching the user's 61-node Neural Galaxy
  const canonicalMemories = [
    // Family & Relationships
    { key: 'wife_name', value: 'Sakshi', memory_type: 'family', importance: 95 },
    { key: 'wife_birthday', value: '23 July', memory_type: 'family', importance: 85 },
    { key: 'wife_skill', value: 'Nail Artist', memory_type: 'family', importance: 80 },
    { key: 'likes_wifes_cooking', value: "Likes Wife's cooking", memory_type: 'family', importance: 75 },
    { key: 'son_name', value: 'Shreshth', memory_type: 'family', importance: 98 },
    { key: 'son_nickname', value: 'Tuku', memory_type: 'family', importance: 90 },
    { key: 'son_birth_date', value: '17/02/2026', memory_type: 'family', importance: 95 },
    { key: 'son_age', value: '7-8 months old', memory_type: 'family', importance: 85 },
    { key: 'father_name', value: 'Suresh', memory_type: 'family', importance: 90 },
    { key: 'father_business', value: 'Market me cloths bechte hai', memory_type: 'family', importance: 80 },
    { key: 'mother_name', value: 'Rajeshree', memory_type: 'family', importance: 90 },
    { key: 'mother_occupation', value: 'Tailor shop in Kaju Pada', memory_type: 'family', importance: 80 },
    { key: 'friend_name', value: 'Sushant', memory_type: 'family', importance: 80 },
    { key: 'pet_name', value: 'Ezra', memory_type: 'family', importance: 85 },
    { key: 'pet_breed', value: 'Rottweiler', memory_type: 'family', importance: 85 },
    { key: 'pet_age', value: 'Almost 4 years', memory_type: 'family', importance: 80 },
    { key: 'pet_location', value: "Given to friend's place due to society issue", memory_type: 'family', importance: 80 },

    // Career & Professional
    { key: 'profession', value: 'Artist / Rapper', memory_type: 'work', importance: 95 },
    { key: 'artist_name', value: 'Shetty Saa', memory_type: 'work', importance: 95 },
    { key: 'artist_genre', value: 'Hip-Hop / Rap', memory_type: 'work', importance: 90 },
    { key: 'career_milestone_mtvhustle', value: 'Top 5 in MTV Hustle Season 1', memory_type: 'work', importance: 90 },
    { key: 'venture_name', value: "Shetty's Dhaba", memory_type: 'work', importance: 90 },
    { key: 'company_name', value: 'Works at Conviction', memory_type: 'work', importance: 90 },
    { key: 'work_schedule', value: '11am - 8pm', memory_type: 'work', importance: 85 },
    { key: 'conviction_hr_target', value: '8 selects each month', memory_type: 'work', importance: 90 },
    { key: 'office_salary_day', value: '5th day of every month', memory_type: 'work', importance: 80 },
    { key: 'office_location', value: 'Customer Support', memory_type: 'work', importance: 75 },
    { key: 'working_hiring_goal', value: 'Aiming for 8 selections each month at Conviction HR', memory_type: 'work', importance: 85 },

    // Lifestyle & Rhythm
    { key: 'location', value: 'Dahisar', memory_type: 'lifestyle', importance: 90 },
    { key: 'passions', value: 'Music', memory_type: 'lifestyle', importance: 90 },
    { key: 'favorite_artists', value: 'Eminem, J Cole, Joyner Lucas, Kendrick Lamar, Drake', memory_type: 'lifestyle', importance: 85 },
    { key: 'favorite_album', value: "Joyner Lucas - Not Now I'm Busy, ADHD 2, Eminem - Marshall Mathers LP", memory_type: 'lifestyle', importance: 80 },
    { key: 'user_drinking_habit', value: 'Drink water', memory_type: 'lifestyle', importance: 70 },
    { key: 'food_preference', value: 'Non-veg / Chicken', memory_type: 'lifestyle', importance: 75 },
    { key: 'favorite_tea', value: 'Masala Chai', memory_type: 'lifestyle', importance: 75 },
    { key: 'daily_routine', value: 'Har roz sube uthne ke...', memory_type: 'lifestyle', importance: 75 },

    // Core Identity
    { key: 'preferred_name', value: 'Saa', memory_type: 'identity', importance: 100 },
    { key: 'birth_date', value: '15/04/1992', memory_type: 'identity', importance: 95 },

    // Goals & Ambitions
    { key: 'primary_goal', value: 'Target: 8 selects each month', memory_type: 'goals', importance: 90 },
    { key: 'music_vision', value: 'Produce new rap tracks & albums', memory_type: 'goals', importance: 85 }
  ];

  console.log(`Upserting ${canonicalMemories.length} canonical memories...`);

  for (const item of canonicalMemories) {
    const { data: existing } = await supabaseAdmin
      .from('memories')
      .select('id')
      .eq('user_id', userId)
      .eq('key', item.key)
      .maybeSingle();

    if (existing) {
      const { error } = await supabaseAdmin
        .from('memories')
        .update({
          value: item.value,
          memory_type: item.memory_type,
          importance: item.importance,
          is_archived: false,
          lifecycle_state: 'CURRENT',
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);
      if (error) console.error(`Error updating ${item.key}:`, error.message);
      else console.log(`Updated memory: ${item.key} -> ${item.value}`);
    } else {
      const { error } = await supabaseAdmin
        .from('memories')
        .insert({
          user_id: userId,
          key: item.key,
          value: item.value,
          memory_type: item.memory_type,
          importance: item.importance,
          is_archived: false,
          lifecycle_state: 'CURRENT',
          source_authority: 'explicit_user'
        });
      if (error) console.error(`Error inserting ${item.key}:`, error.message);
      else console.log(`Inserted memory: ${item.key} -> ${item.value}`);
    }
  }

  // Clear analytics cache
  invalidateAnalyticsCache(userId);
  console.log('Cleared analytics cache.');

  // Verify memory counts
  const { data: activeMem } = await supabaseAdmin
    .from('memories')
    .select('id, key, value, memory_type')
    .eq('user_id', userId)
    .eq('is_archived', false)
    .not('lifecycle_state', 'in', '(SUPERSEDED,INVALIDATED)');

  console.log(`\nActive unarchived memories in DB: ${activeMem?.length}`);

  // Also query working memory
  const { data: wmRows } = await supabaseAdmin
    .from('working_memory')
    .select('key, value')
    .eq('user_id', userId);

  // Test dynamic KG synthesis
  const { buildDynamicKnowledgeGraph } = await import('../lib/memoryDomains');
  const kg = buildDynamicKnowledgeGraph(activeMem as any, wmRows as any, 'Saa');
  console.log(`\n=== KNOWLEDGE GRAPH SYNTHESIS RESULT ===`);
  console.log(`Total Knowledge Graph Nodes: ${kg.nodes.length}`);
  console.log(`Total Knowledge Graph Edges: ${kg.edges.length}`);
  console.log('Departments breakdown:');
  for (const dept of (kg.departments as any[])) {
    console.log(`  - ${dept.name} (${dept.id}): ${dept.count} nodes`);
  }
}

main().catch(console.error);
