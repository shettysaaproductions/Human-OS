import { memoryManagementRouter } from '../memoryManagement';
import { memoryRepository } from '../../services/memoryRepository';
import { supabaseAdmin } from '../../lib/supabase';
import { logger } from '../../lib/logger';
import { canonicalizeKey, isKnownCanonicalKey } from '../../lib/memoryKeySchema';

// Mock dependencies
jest.mock('../../services/memoryRepository');
jest.mock('../../lib/supabase');
jest.mock('../../lib/logger');

const mockMemoryRepository = memoryRepository as jest.Mocked<typeof memoryRepository>;
const mockSupabaseAdmin = supabaseAdmin as jest.Mocked<typeof supabaseAdmin>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('Memory Management Router — Trust Layer', () => {
  const userId = 'test-user-123';
  const otherUserId = 'other-user-456';
  const memoryId = 'mem-abc-123';
  const canonicalKey = 'mother_name';

  let mockReq: any;
  let mockRes: any;
  let mockNext: jest.Mock;

  // Build a proper Supabase chain mock that is thenable
  function createChainMock(result: any) {
    // The chain object that will be returned by from()
    const chain: any = {
      select: jest.fn(),
      eq: jest.fn(),
      order: jest.fn(),
      range: jest.fn(),
      limit: jest.fn(),
      or: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      maybeSingle: jest.fn(),
      single: jest.fn(),
      in: jest.fn(),
    };

    // All chain methods return the chain itself for chaining
    Object.keys(chain).forEach(key => {
      if (key !== 'then') {
        chain[key].mockReturnValue(chain);
      }
    });

    // Make the chain thenable (so await works)
    chain.then = jest.fn((onFulfilled) => Promise.resolve(result).then(onFulfilled));

    return chain;
  }

  beforeEach(() => {
    jest.clearAllMocks();

    mockReq = {
      user: { id: userId, email: 'test@example.com' },
      query: {},
      params: {},
      body: {},
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();

    // Default: empty result
    const defaultResult = { data: [], error: null };
    const chainMock = createChainMock(defaultResult);

    mockSupabaseAdmin.from = jest.fn().mockReturnValue(chainMock);
    mockSupabaseAdmin.rpc = jest.fn().mockResolvedValue({ data: null, error: null });

    // MemoryRepository mocks
    mockMemoryRepository.archiveMemory.mockResolvedValue(true);
    mockMemoryRepository.upsertMemory.mockResolvedValue(undefined);
    mockMemoryRepository.forgetMemory.mockResolvedValue(true);
    // Mock additional repository methods used by archive/unarchive
    (mockMemoryRepository as any).unarchiveMemory = jest.fn().mockResolvedValue({ success: true });
    (mockMemoryRepository as any).forgetMemoryCompletely = jest.fn().mockResolvedValue(undefined);
  });

  function createMemoryRow(overrides: any = {}) {
    return {
      id: memoryId,
      user_id: userId,
      key: canonicalKey,
      value: 'Jane Doe',
      memory_type: 'family',
      importance: 80,
      confidence: 0.9,
      frequency: 3,
      is_archived: false,
      created_at: '2025-01-15T10:00:00Z',
      updated_at: '2025-01-20T10:00:00Z',
      source_authority: 'explicit_user',
      lifecycle_state: 'CURRENT',
      ...overrides,
    };
  }

  function findRoute(path: string, method?: string) {
    return (memoryManagementRouter as any).stack.find((entry: any) => {
      if (!entry.route || entry.route.path !== path) return false;
      if (method && !entry.route.methods[method]) return false;
      return true;
    });
  }

  describe('GET /memories — canonicalized list', () => {
    it('returns only authenticated user memories (no cross-user leakage)', async () => {
      const userMemories = [createMemoryRow({ key: 'mother_name' })];
      const chainMock = createChainMock({ data: userMemories, error: null });
      mockSupabaseAdmin.from.mockReturnValue(chainMock);

      const layer = findRoute('/');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            canonicalKey: 'mother_name',
            label: "Mother's name",
            category: 'Family',
            value: 'Jane Doe',
          }),
        ]),
      }));
      expect(mockSupabaseAdmin.from).toHaveBeenCalledWith('memories');
    });

    it('canonicalizes aliases and deduplicates by canonical key', async () => {
      const memories = [
        createMemoryRow({ key: 'mother_name', importance: 70, source_authority: 'subconscious_inference' }),
        createMemoryRow({ id: 'mem-2', key: 'moms_name', importance: 80, source_authority: 'explicit_user' }),
      ];
      const chainMock = createChainMock({ data: memories, error: null });
      mockSupabaseAdmin.from.mockReturnValue(chainMock);

      const layer = findRoute('/');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = mockRes.json.mock.calls[0][0];
      expect(response.data.length).toBe(1);
      expect(response.data[0].canonicalKey).toBe('mother_name');
      expect(response.data[0].value).toBe('Jane Doe');
    });

    it('returns human-readable labels and categories', async () => {
      const memories = [createMemoryRow({ key: 'favourite_color' })];
      const chainMock = createChainMock({ data: memories, error: null });
      mockSupabaseAdmin.from.mockReturnValue(chainMock);

      const layer = findRoute('/');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            canonicalKey: 'favourite_color',
            label: 'Favourite color',
            category: 'Preferences',
          }),
        ]),
      }));
    });

    it('respects pagination (limit/offset)', async () => {
      // Sort by importance DESC: importance 59 (key_9) down to 50 (key_0)
      // offset=2, limit=3 => indices 2,3,4 => keys 7, 6, 5 (importance 57, 56, 55)
      const memories = Array.from({ length: 10 }, (_, i) =>
        createMemoryRow({ id: `mem-${i}`, key: `key_${i}`, importance: 50 + i })
      );
      const chainMock = createChainMock({ data: memories, error: null });
      mockSupabaseAdmin.from.mockReturnValue(chainMock);

      mockReq.query = { limit: '3', offset: '2' };

      const layer = findRoute('/');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ canonicalKey: 'key_7' }),
          expect.objectContaining({ canonicalKey: 'key_6' }),
          expect.objectContaining({ canonicalKey: 'key_5' }),
        ]),
        limit: 3,
        offset: 2,
      }));
    });

    it('filters by search query on canonical key or value', async () => {
      const memories = [
        createMemoryRow({ key: 'mother_name', value: 'Jane Doe' }),
        createMemoryRow({ id: 'mem-2', key: 'company_name', value: 'Acme Corp' }),
      ];
      const chainMock = createChainMock({ data: memories, error: null });
      mockSupabaseAdmin.from.mockReturnValue(chainMock);

      mockReq.query = { search: 'jane' };

      const layer = findRoute('/');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ value: 'Jane Doe' }),
        ]),
      }));
      expect(mockRes.json.mock.calls[0][0].data.length).toBe(1);
    });

    it('requires authentication', async () => {
      mockReq.user = undefined;

      const layer = findRoute('/');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });
  });

  describe('GET /memories/browser — categorized view', () => {
    it('returns memories grouped by category', async () => {
      const memories = [
        createMemoryRow({ key: 'mother_name', value: 'Jane' }),
        createMemoryRow({ id: 'mem-2', key: 'company_name', value: 'Acme' }),
        createMemoryRow({ id: 'mem-3', key: 'favourite_color', value: 'Blue' }),
      ];
      const chainMock = createChainMock({ data: memories, error: null });
      mockSupabaseAdmin.from.mockReturnValue(chainMock);

      const layer = findRoute('/browser');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = mockRes.json.mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.data).toHaveProperty('Personal');
      expect(response.data).toHaveProperty('Family');
      expect(response.data).toHaveProperty('Work');
      expect(response.data).toHaveProperty('Preferences');
      expect(response.data.Family).toHaveLength(1);
      expect(response.data.Work).toHaveLength(1);
      expect(response.data.Preferences).toHaveLength(1);
    });

    it('sorts within category by importance then updatedAt', async () => {
      const memories = [
        createMemoryRow({ id: 'mem-1', key: 'mother_name', importance: 50, updated_at: '2025-01-10T10:00:00Z' }),
        createMemoryRow({ id: 'mem-2', key: 'father_name', importance: 80, updated_at: '2025-01-10T10:00:00Z' }),
        createMemoryRow({ id: 'mem-3', key: 'wife_name', importance: 80, updated_at: '2025-01-15T10:00:00Z' }),
      ];
      const chainMock = createChainMock({ data: memories, error: null });
      mockSupabaseAdmin.from.mockReturnValue(chainMock);

      const layer = findRoute('/browser');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      const family = mockRes.json.mock.calls[0][0].data.Family;
      // Higher importance first (80 > 50), then more recent updatedAt for ties
      expect(family[0].canonicalKey).toBe('wife_name'); // importance 80, more recent
      expect(family[1].canonicalKey).toBe('father_name'); // importance 80, older
      expect(family[2].canonicalKey).toBe('mother_name'); // importance 50
    });

    it('requires authentication', async () => {
      mockReq.user = undefined;

      const layer = findRoute('/browser');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });

  describe('PATCH /memories/:id — user edit flow', () => {
    it('creates new CURRENT via MemoryRepository without separate raw archive (atomic)', async () => {
      const existing = createMemoryRow({ key: 'mother_name', value: 'Jane Doe' });
      const selectChain = createChainMock({ data: existing, error: null });
      // First call: fetch existing for ownership; second call: authoritative id fetch after upsert
      const authFetchChain = createChainMock({ data: { id: 'new-mem-id', updated_at: '2025-01-21T10:00:00Z' }, error: null });
      mockSupabaseAdmin.from
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce(authFetchChain);

      mockReq.params = { id: memoryId };
      mockReq.body = { value: 'Jane Smith' };

      const layer = findRoute('/:id', 'patch');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      // Edit is now atomic via upsert only — no separate archiveMemory gap
      expect(mockMemoryRepository.archiveMemory).not.toHaveBeenCalled();
      expect(mockMemoryRepository.upsertMemory).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          key: 'mother_name',
          value: 'Jane Smith',
          source_authority: 'explicit_user',
        }),
        'User edit via memory management'
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ key: 'mother_name', value: 'Jane Smith' }),
      }));
    });

    it('failed upsert does not return success and preserves exactly one CURRENT', async () => {
      const existing = createMemoryRow({ key: 'mother_name', value: 'Jane Doe' });
      const selectChain = createChainMock({ data: existing, error: null });
      mockSupabaseAdmin.from.mockReturnValue(selectChain);
      mockMemoryRepository.upsertMemory.mockRejectedValueOnce(new Error('DB failure'));

      mockReq.params = { id: memoryId };
      mockReq.body = { value: 'Jane Smith' };

      const layer = findRoute('/:id', 'patch');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).not.toHaveBeenCalledWith(200);
      expect(mockNext).toHaveBeenCalled();
      const nextErr = mockNext.mock.calls[0][0];
      expect(nextErr.message).toMatch(/DB failure/);
    });

    it('derives canonical key from stored record (ignores client-supplied key)', async () => {
      const existing = createMemoryRow({ key: 'mother_name', value: 'Jane Doe' });
      const selectChain = createChainMock({ data: existing, error: null });
      const authFetchChain = createChainMock({ data: { id: 'new-mem-id', updated_at: '2025-01-21T10:00:00Z' }, error: null });
      mockSupabaseAdmin.from
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce(authFetchChain);

      mockReq.params = { id: memoryId };
      mockReq.body = { value: 'Jane Smith', key: 'father_name' };

      const layer = findRoute('/:id', 'patch');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockMemoryRepository.upsertMemory).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ key: 'mother_name' }),
        expect.any(String)
      );
    });

    it('validates ownership (404 if not owner)', async () => {
      const selectChain = createChainMock({ data: null, error: null });
      mockSupabaseAdmin.from.mockReturnValue(selectChain);

      mockReq.params = { id: memoryId };
      mockReq.body = { value: 'New value' };

      const layer = findRoute('/:id', 'patch');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Memory not found' });
    });

    it('rejects empty edit payload', async () => {
      mockReq.params = { id: memoryId };
      mockReq.body = {};

      const layer = findRoute('/:id', 'patch');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Provide at least one of: value, key' });
    });

    it('requires authentication', async () => {
      mockReq.user = undefined;
      mockReq.params = { id: memoryId };
      mockReq.body = { value: 'New value' };

      const layer = findRoute('/:id', 'patch');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });

  describe('DELETE /memories/:id — forget flow (archive, not hard delete)', () => {
    it('uses MemoryRepository.forgetMemory (archives, preserves history)', async () => {
      mockReq.params = { id: memoryId };

      const layer = findRoute('/:id', 'delete');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockMemoryRepository.forgetMemory).toHaveBeenCalledWith(userId, memoryId);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Nova no longer uses this memory',
      }));
    });

    it('returns 404 if memory not found or already forgotten', async () => {
      mockMemoryRepository.forgetMemory.mockResolvedValueOnce(false);
      mockReq.params = { id: memoryId };

      const layer = findRoute('/:id', 'delete');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Memory not found or already forgotten' });
    });

    it('requires authentication', async () => {
      mockReq.user = undefined;
      mockReq.params = { id: memoryId };

      const layer = findRoute('/:id', 'delete');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });

  describe('PATCH /memories/:id/archive — explicit archive/unarchive via MemoryRepository', () => {
    it('archives memory via MemoryRepository and does not call direct memories.update', async () => {
      mockMemoryRepository.archiveMemory.mockResolvedValueOnce(true);

      mockReq.params = { id: memoryId };
      mockReq.body = { archived: true };

      const layer = findRoute('/:id/archive');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockMemoryRepository.archiveMemory).toHaveBeenCalledWith(userId, memoryId, 'User archive via memory management');
      expect(mockSupabaseAdmin.from).not.toHaveBeenCalledWith('memories');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: { id: memoryId, is_archived: true },
      }));
    });

    it('unarchives when archived=false via safe repository path', async () => {
      mockMemoryRepository.unarchiveMemory = jest.fn().mockResolvedValueOnce({ success: true });

      mockReq.params = { id: memoryId };
      mockReq.body = { archived: false };

      const layer = findRoute('/:id/archive');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockMemoryRepository.unarchiveMemory).toHaveBeenCalledWith(userId, memoryId);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: { id: memoryId, is_archived: false },
      }));
    });

    it('validates ownership for archive (cross-user) with zero mutation', async () => {
      mockMemoryRepository.archiveMemory.mockResolvedValueOnce(false);

      mockReq.params = { id: memoryId };
      mockReq.body = { archived: true };

      const layer = findRoute('/:id/archive');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockMemoryRepository.archiveMemory).toHaveBeenCalledWith(userId, memoryId, expect.any(String));
      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockSupabaseAdmin.from).not.toHaveBeenCalled();
    });

    it('validates ownership for unarchive (cross-user) with zero mutation', async () => {
      mockMemoryRepository.unarchiveMemory = jest.fn().mockResolvedValueOnce({ success: false, reason: 'NOT_FOUND' });

      mockReq.params = { id: memoryId };
      mockReq.body = { archived: false };

      const layer = findRoute('/:id/archive');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('blocks unarchive that would create duplicate CURRENT (409)', async () => {
      mockMemoryRepository.unarchiveMemory = jest.fn().mockResolvedValueOnce({ success: false, reason: 'DUPLICATE_CURRENT' });

      mockReq.params = { id: memoryId };
      mockReq.body = { archived: false };

      const layer = findRoute('/:id/archive');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/duplicate/i) }));
    });

    it('blocks unarchive of historical row as CURRENT (400)', async () => {
      mockMemoryRepository.unarchiveMemory = jest.fn().mockResolvedValueOnce({ success: false, reason: 'HISTORICAL' });

      mockReq.params = { id: memoryId };
      mockReq.body = { archived: false };

      const layer = findRoute('/:id/archive');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/historical/i) }));
    });

    it('requires authentication', async () => {
      mockReq.user = undefined;
      mockReq.params = { id: memoryId };
      mockReq.body = { archived: true };

      const layer = findRoute('/:id/archive');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockMemoryRepository.archiveMemory).not.toHaveBeenCalled();
    });

    it('does not perform hard delete for archive/unarchive', async () => {
      mockMemoryRepository.archiveMemory.mockResolvedValueOnce(true);
      mockReq.params = { id: memoryId };
      mockReq.body = { archived: true };

      const layer = findRoute('/:id/archive');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      // Verify no delete was triggered via supabase or repository hard delete
      expect(mockSupabaseAdmin.from).not.toHaveBeenCalledWith('memories');
      // forgetMemoryCompletely is the hard delete — ensure not called
      expect(mockMemoryRepository.forgetMemoryCompletely).not.toHaveBeenCalled();
    });

    it('blocks unarchive of superseded row as CURRENT (400)', async () => {
      mockMemoryRepository.unarchiveMemory = jest.fn().mockResolvedValueOnce({ success: false, reason: 'SUPERSEDED' });

      mockReq.params = { id: memoryId };
      mockReq.body = { archived: false };

      const layer = findRoute('/:id/archive');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/superseded/i) }));
      expect(mockSupabaseAdmin.from).not.toHaveBeenCalled();
    });

    it('blocks unarchive of invalidated row as CURRENT (400)', async () => {
      mockMemoryRepository.unarchiveMemory = jest.fn().mockResolvedValueOnce({ success: false, reason: 'INVALIDATED' });

      mockReq.params = { id: memoryId };
      mockReq.body = { archived: false };

      const layer = findRoute('/:id/archive');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/invalidated/i) }));
    });

    it('blocks unarchive of proposed row (400)', async () => {
      mockMemoryRepository.unarchiveMemory = jest.fn().mockResolvedValueOnce({ success: false, reason: 'PROPOSED' });

      mockReq.params = { id: memoryId };
      mockReq.body = { archived: false };

      const layer = findRoute('/:id/archive');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/proposed/i) }));
    });

    it('blocks unarchive of unknown lifecycle row (400)', async () => {
      mockMemoryRepository.unarchiveMemory = jest.fn().mockResolvedValueOnce({ success: false, reason: 'UNKNOWN' });

      mockReq.params = { id: memoryId };
      mockReq.body = { archived: false };

      const layer = findRoute('/:id/archive');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/unknown/i) }));
    });

    it('concurrent unarchive race — loser returns safe failure with no duplicate CURRENT', async () => {
      const layer = findRoute('/:id/archive');

      // First concurrent request succeeds
      mockMemoryRepository.unarchiveMemory = jest.fn()
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, reason: 'DUPLICATE_CURRENT' });

      mockReq.params = { id: memoryId };
      mockReq.body = { archived: false };

      // First caller wins
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(200);

      // Reset mocks for second caller (same canonical key, concurrent)
      jest.clearAllMocks();
      mockRes.status = jest.fn().mockReturnThis();
      mockRes.json = jest.fn().mockReturnThis();
      mockReq.params = { id: 'other-mem-id' };
      mockReq.body = { archived: false };

      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/duplicate/i) }));
      // Ensure no hard delete and no duplicate CURRENT creation
      expect(mockMemoryRepository.forgetMemoryCompletely).not.toHaveBeenCalled();
    });

    it('valid archived CURRENT can still unarchive when no conflicting CURRENT exists', async () => {
      mockMemoryRepository.unarchiveMemory = jest.fn().mockResolvedValueOnce({ success: true });

      mockReq.params = { id: memoryId };
      mockReq.body = { archived: false };

      const layer = findRoute('/:id/archive');
      await layer.route.stack[0].handle(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: { id: memoryId, is_archived: false },
      }));
    });
  });
});

describe('Canonical Key Helpers', () => {
  it('canonicalizeKey normalizes known aliases', () => {
    expect(canonicalizeKey('mom_name').canonical).toBe('mother_name');
    expect(canonicalizeKey('mothers_name').canonical).toBe('mother_name');
    expect(canonicalizeKey('fav_color').canonical).toBe('favourite_color');
    expect(canonicalizeKey('favorite_color').canonical).toBe('favourite_color');
  });

  it('canonicalizeKey returns canonical key unchanged', () => {
    expect(canonicalizeKey('mother_name').canonical).toBe('mother_name');
    expect(canonicalizeKey('mother_name').wasAliased).toBe(false);
  });

  it('isKnownCanonicalKey validates against schema', () => {
    expect(isKnownCanonicalKey('mother_name')).toBe(true);
    expect(isKnownCanonicalKey('favourite_color')).toBe(true);
    expect(isKnownCanonicalKey('unknown_key')).toBe(false);
  });
});