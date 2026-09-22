/**
 * Phase 3 Integration Verification
 * Validates that ContextPacket is the canonical LLM-facing context source.
 *
 * Test coverage:
 *  T01 - buildContextPacket produces a valid packet from a minimal snapshot
 *  T02 - packet.memories bounded by maxMemories
 *  T03 - cogCtx durableFacts used when provided (usedCogCtxMemories=true)
 *  T04 - cogCtx durableFacts merged with snapshot gap-fill (keys not in cogCtx added from snapshot)
 *  T05 - formatContextPacketForPrompt returns correct shape for promptBuilder
 *  T06 - formatContextPacketForPrompt memories includes importance/confidence from snapshot
 *  T07 - workingMemories come from workingMemoryRows (not raw workingMemory Map)
 *  T08 - recentMessages bounded by maxChatMessages and HIDDEN_CONTEXT filtered
 *  T09 - shortTermMemories bounded by maxStm with timestamp field populated
 *  T10 - packet.metrics.usedCogCtxMemories=false when cogCtx not provided
 *  T11 - packet.metrics.conflictsResolved mirrors cogCtx.metadata.conflicts_resolved
 *  T12 - summarizeContextPacket includes cogCtx and conflicts fields
 *  T13 - HIDDEN_CONTEXT messages filtered from conversation section
 *  T14 - keyword matching promotes relevant memories before non-relevant
 *  T15 - snapshotErrors propagated from snapshot.errors.length
 *  T16 - ContextPacket._rawSnapshot is accessible (needed by formatContextPacketForPrompt)
 */

import { buildContextPacket, formatContextPacketForPrompt, summarizeContextPacket } from '../services/ContextPacket';
import type { UserContextSnapshot } from '../services/UserContextSnapshot';

function makeSnapshot(overrides: Partial<UserContextSnapshot> = {}): UserContextSnapshot {
  const base: UserContextSnapshot = {
    userId: 'test-user-123',
    hydratedAt: new Date().toISOString(),
    isComplete: true,
    errors: [],
    profile: {
      id: 'test-user-123',
      preferred_name: 'Saa',
      companion_personality: 'warm_friend',
      grammatical_gender: 'male',
      country: 'IN',
      timezone_offset: 5.5,
      push_token: 'tok_abc',
      preferred_language: 'hi',
    },
    temporalContext: {
      hour: 14,
      dayOfWeek: 'Wednesday',
      isMorning: false, isAfternoon: true, isEvening: false, isNight: false, isSleepWindow: false,
      timeOfDayLabel: 'afternoon',
      localIso: new Date().toISOString(),
      tzOffset: 5.5,
      tzLabel: 'IST',
    },
    presence: { status: 'online' },
    workingMemory: new Map([['wake_time', '6am']]),
    workingMemoryRows: [{ key: 'wake_time', value: '6am' }, { key: 'gym_days', value: 'Mon Wed Fri' }],
    recentChat: [
      { role: 'user', content: 'Hey Nova' },
      { role: 'assistant', content: 'Hey!' },
      { role: 'user', content: '[HIDDEN_CONTEXT] system context injection' },
      { role: 'user', content: 'How are you?' },
    ],
    recentChatTokenEstimate: 40,
    memories: [
      { id: 'm1', key: 'name', value: 'Rahul', memory_type: 'personal', importance: 1.0, confidence: 0.99, created_at: new Date(Date.now() - 86400000).toISOString() },
      { id: 'm2', key: 'job', value: 'Engineer', memory_type: 'personal', importance: 0.8, confidence: 0.9, created_at: new Date(Date.now() - 172800000).toISOString() },
      { id: 'm3', key: 'hobby', value: 'Cricket', memory_type: 'interests', importance: 0.6, confidence: 0.85 },
      { id: 'm4', key: 'city', value: 'Mumbai', memory_type: 'personal', importance: 0.7, confidence: 0.95 },
    ],
    shortTermMemories: [
      { id: 'stm1', memory: 'Feeling tired today', emotion: 'tired', importance: 0.7, created_at: new Date(Date.now() - 3600000).toISOString() },
      { id: 'stm2', memory: 'Had a big meeting', emotion: 'stressed', importance: 0.8, created_at: new Date(Date.now() - 7200000).toISOString() },
    ],
    entityBubbles: [{ id: 'e1', name: 'Priya', relation_type: 'friend', entity_type: 'person', summary: 'Best friend from college' }],
    latestEmotion: { mood: 'happy', intensity: 0.7 },
    recentEpisodic: [],
    latestReflection: { summary: 'User is making progress on fitness goals' },
    lifeThreads: [{ id: 'lt1', topic: 'fitness', state: 'active', priority: 1, next_useful_step: 'gym tomorrow' }],
    pendingAgenda: [],
    novaActions: [],
    recentOutreach: [],
    lastOutreachAt: null,
    isSuppressed: false,
    hasOverdueAgenda: false,
    effectiveMinGapMinutes: 30,
    isOnline: true,
  };
  return { ...base, ...overrides };
}

let passed = 0;
let failed = 0;
const results: string[] = [];

function assert(id: string, condition: boolean, detail = '') {
  if (condition) {
    passed++;
    results.push(`  ✅ ${id}${detail ? ': ' + detail : ''}`);
  } else {
    failed++;
    results.push(`  ❌ ${id}${detail ? ': ' + detail : ''}`);
  }
}

async function runTests() {
  console.log('\n[Phase3 Integration Verify] Running 18 tests...\n');

  const snap = makeSnapshot();

  // T01: buildContextPacket produces a valid packet
  const pkt = buildContextPacket(snap, { operation: 'chat' });
  assert('T01', !!pkt && pkt.userId === 'test-user-123' && pkt.operation === 'chat', `userId=${pkt.userId}`);

  // T02: memories bounded by maxMemories (default chat=12, we have 4, all should be included)
  assert('T02', pkt.memories.data.length === 4, `mem=${pkt.memories.data.length}`);

  // T03: cogCtx durableFacts used when provided
  const cogCtx = {
    memories: {
      durableFacts: [
        { id: 'cf1', key: 'name', value: 'Rahul (verified)', memory_type: 'personal', importance: 1.0, confidence: 1.0 },
      ],
    },
    metadata: { conflicts_detected: 1, conflicts_resolved: 1 },
  };
  const pktCog = buildContextPacket(snap, { operation: 'chat', cogCtx });
  assert('T03', pktCog.metrics.usedCogCtxMemories === true, `usedCogCtx=${pktCog.metrics.usedCogCtxMemories}`);

  // T04: cogCtx durableFacts merged with snapshot gap-fill
  const cogCtxMergeTest = {
    memories: {
      durableFacts: [{ id: 'cf1', key: 'name', value: 'Rahul (cogCtx)', memory_type: 'personal', importance: 1.0, confidence: 1.0 }],
    },
    metadata: { conflicts_resolved: 1 },
  };
  const pktMerge = buildContextPacket(snap, { operation: 'chat', cogCtx: cogCtxMergeTest });
  // Should have name from cogCtx + job, hobby, city from snapshot gap-fill
  const keysMerge = pktMerge.memories.data.map(m => m.key);
  assert('T04', keysMerge.includes('name') && keysMerge.includes('job') && keysMerge.includes('city'),
    `keys=${keysMerge.join(',')}`);

  // T05: formatContextPacketForPrompt returns correct shape
  const shape = formatContextPacketForPrompt(pkt);
  assert('T05',
    Array.isArray(shape.memories) && Array.isArray(shape.workingMemories) && Array.isArray(shape.recentMessages) &&
    typeof shape.preferredName !== 'undefined' && typeof shape.preferredLanguage !== 'undefined',
    `name=${shape.preferredName} lang=${shape.preferredLanguage}`);

  // T06: formatted memories preserve bounded metadata
  const shapeMem = shape.memories.find(m => m.key === 'name');
  assert('T06', shapeMem !== undefined && shapeMem.importance !== undefined && shapeMem.confidence !== undefined,
    `importance=${shapeMem?.importance} confidence=${shapeMem?.confidence}`);

  // T07: workingMemories are bounded packet data (not raw snapshot access)
  assert('T07', shape.workingMemories.length === 2 && shape.workingMemories[0].key === 'wake_time',
    `wm_count=${shape.workingMemories.length}`);

  // T17: CognitiveContext's conflict-resolved value survives all the way to prompt shape
  const cogShape = formatContextPacketForPrompt(pktCog);
  const cogName = cogShape.memories.find(m => m.key === 'name');
  assert('T17', cogName?.value === 'Rahul (verified)',
    `final_name=${cogName?.value}`);

  // T18: ContextPacket is self-contained and no longer exposes a raw snapshot
  assert('T18', !Object.prototype.hasOwnProperty.call(pkt, '_rawSnapshot'),
    'raw snapshot escape hatch removed');

  // T08: recentMessages bounded and HIDDEN_CONTEXT filtered
  // snap has 4 msgs, 1 is HIDDEN_CONTEXT → 3 remain; default maxChatMessages=15 so all pass
  assert('T08', shape.recentMessages.length === 3 && !shape.recentMessages.some(m => m.content.startsWith('[HIDDEN_CONTEXT]')),
    `msgs=${shape.recentMessages.length}`);

  // T09: shortTermMemories bounded with timestamp
  assert('T09', shape.shortTermMemories.length === 2 && shape.shortTermMemories[0].timestamp !== undefined,
    `stm=${shape.shortTermMemories.length} ts=${shape.shortTermMemories[0].timestamp}`);

  // T10: usedCogCtxMemories=false when no cogCtx
  assert('T10', pkt.metrics.usedCogCtxMemories === false, `usedCogCtx=${pkt.metrics.usedCogCtxMemories}`);

  // T11: conflictsResolved mirrors cogCtx.metadata.conflicts_resolved
  assert('T11', pktCog.metrics.conflictsResolved === 1, `conflictsResolved=${pktCog.metrics.conflictsResolved}`);

  // T12: summarizeContextPacket includes cogCtx and conflicts fields
  const summary = summarizeContextPacket(pkt);
  assert('T12', summary.includes('cogCtx=') && summary.includes('conflicts='), `summary=${summary}`);

  // T13: HIDDEN_CONTEXT filtered from packet.conversation.data
  const hiddenMsg = pkt.conversation.data.find(m => m.content.startsWith('[HIDDEN_CONTEXT]'));
  assert('T13', hiddenMsg === undefined, `hidden_in_packet=${hiddenMsg !== undefined}`);

  // T14: keyword matching promotes relevant memories
  const keywordSnap = makeSnapshot({
    memories: [
      { id: 'k1', key: 'cricket_bat', value: 'SG brand', memory_type: 'interests', importance: 0.5, confidence: 0.8 },
      { id: 'k2', key: 'name', value: 'Rahul', memory_type: 'personal', importance: 0.9, confidence: 0.99 },
    ]
  });
  const pktKw = buildContextPacket(keywordSnap, { operation: 'chat', turnKeywords: ['cricket'] });
  assert('T14', pktKw.memories.data[0].key === 'cricket_bat', `first_mem_key=${pktKw.memories.data[0].key}`);

  // T15: snapshotErrors propagated
  const snapWithErr = makeSnapshot({ errors: ['profile_fetch_failed', 'stm_timeout'] });
  const pktErr = buildContextPacket(snapWithErr, { operation: 'chat' });
  assert('T15', pktErr.metrics.snapshotErrors === 2, `errors=${pktErr.metrics.snapshotErrors}`);

  // T16: _rawSnapshot accessible
  assert('T16', pkt._rawSnapshot !== undefined && pkt._rawSnapshot.userId === 'test-user-123',
    `rawSnap.userId=${pkt._rawSnapshot?.userId}`);

  // Results
  console.log(results.join('\n'));
  console.log(`\n[Phase3 Integration Verify] ${passed}/${passed + failed} tests passed`);

  if (failed > 0) {
    console.error(`\n❌ ${failed} test(s) FAILED`);
    process.exit(1);
  } else {
    console.log('\n✅ All 18 Phase 3.1 tests passed. ContextPacket is the canonical LLM-facing context source.');
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('[Phase3 Verify] Fatal error:', err);
  process.exit(1);
});
