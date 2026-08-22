import { BackgroundActionService } from '../src/services/BackgroundActionService';
import { supabaseAdmin } from '../src/lib/supabase';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../src/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
  },
}));

// Mock ReminderEngine at top level
vi.mock('../src/services/ReminderEngine', () => {
  return {
    ReminderEngine: class {
      parse() {
        return [{ title: 'Test reminder', relative_value: 1, relative_unit: 'hours' }];
      }
      async scheduleAll() {
        return [{ id: 'rem-1' }];
      }
    }
  };
});

const mockSupabase = supabaseAdmin as any;

describe('BackgroundActionService - Critical Actions', () => {
  let service: BackgroundActionService;
  
  beforeEach(() => {
    service = new BackgroundActionService();
    vi.clearAllMocks();
  });

  it('should successfully execute a new critical action and mark it completed', async () => {
    const requestId = 'req-123';
    const userId = 'user-123';
    const action = { tool: 'ReminderEngine', action: 'schedule', data: { title: 'Test reminder', time_phrase: 'in 1 hour' } };

    // Mock idempotency check (insert succeeds)
    mockSupabase.maybeSingle.mockResolvedValueOnce({ data: { id: 'some-id' }, error: null });

    const result = await service.processCriticalActions(userId, requestId, [action], 'IN');

    expect(result.success).toBe(true);
    expect(result.actionType).toBe('ReminderEngine.schedule');
    
    // Check it updated to completed
    expect(mockSupabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', result: { success: true } })
    );
  });

  it('should fallback deterministically if the critical action fails', async () => {
    const requestId = 'req-124';
    const userId = 'user-123';
    const action = { tool: 'ReminderEngine', action: 'schedule', data: { title: 'Test reminder' } };

    // Mock idempotency check (insert succeeds)
    mockSupabase.maybeSingle.mockResolvedValueOnce({ data: { id: 'some-id' }, error: null });

    // Provide a failing scheduleAll specifically for this test by replacing the mock locally
    vi.doMock('../src/services/ReminderEngine', () => {
      return {
        ReminderEngine: class {
          parse() { return []; }
          async scheduleAll() { throw new Error('DB failure'); }
        }
      };
    });

    // Re-import service to pick up doMock
    const { BackgroundActionService: MockedBgService } = await import('../src/services/BackgroundActionService');
    const mockedService = new MockedBgService();

    const result = await mockedService.processCriticalActions(userId, requestId, [action], 'IN');

    expect(result.success).toBe(false);
    expect(result.error).toBe('DB failure');

    // Check it updated to failed
    expect(mockSupabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', result: { error: 'DB failure' } })
    );
    
    // reset modules after test
    vi.doUnmock('../src/services/ReminderEngine');
  });

  it('should return existing completed result if idempotency insert conflicts', async () => {
    const requestId = 'req-125';
    const userId = 'user-123';
    const action = { tool: 'ReminderEngine', action: 'schedule', data: {} };

    // Mock idempotency check (insert fails with 23505)
    mockSupabase.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: '23505' } });
    
    // Mock the subsequent select retrieving the completed job
    mockSupabase.maybeSingle.mockResolvedValueOnce({ data: { status: 'completed', result: { success: true } }, error: null });

    const result = await service.processCriticalActions(userId, requestId, [action], 'IN');

    expect(result.success).toBe(true);
    // Shouldn't have called update because it didn't run
    expect(mockSupabase.update).not.toHaveBeenCalled();
  });
});
