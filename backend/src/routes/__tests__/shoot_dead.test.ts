import { AccountLifecycleService, accountLifecycleService } from '../../services/AccountLifecycleService';
import { supabaseAdmin } from '../../lib/supabase';
import { cache } from '../../lib/cache';
import { logger } from '../../lib/logger';

// Mock dependencies
jest.mock('../../lib/supabase', () => {
  const mSupabase = {
    auth: {
      admin: {
        deleteUser: jest.fn(),
      }
    },
    from: jest.fn(),
  };
  return { supabaseAdmin: mSupabase };
});

jest.mock('../../lib/cache', () => ({
  cache: {
    invalidate: jest.fn(),
  }
}));

jest.mock('../../lib/logger');

describe('AccountLifecycleService - Shoot Dead Verification', () => {
  let mockEq: jest.Mock;
  let mockIn: jest.Mock;
  let mockDelete: jest.Mock;
  let mockSelect: jest.Mock;
  let mockUpdate: jest.Mock;

  beforeEach(() => {
    mockEq = jest.fn().mockResolvedValue({ count: 1, error: null, data: [] });
    mockIn = jest.fn().mockResolvedValue({ count: 1, error: null, data: [] });
    mockDelete = jest.fn().mockReturnValue({ eq: mockEq, in: mockIn, count: 'exact' });
    
    // Simulate finding chat_history IDs for orphan wipe
    mockSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ data: [{ id: 'chat1' }, { id: 'chat2' }] })
    });
    
    mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => ({
      delete: mockDelete,
      select: mockSelect,
      update: mockUpdate,
    }));
    
    (supabaseAdmin.auth.admin.deleteUser as jest.Mock).mockResolvedValue({ error: null });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('eradicates all 34 mapped user tables plus telemetry and orphans', async () => {
    const userId = 'target-user-123';
    const result = await accountLifecycleService.deleteAccount(userId);

    expect(result.success).toBe(true);
    expect(result.authDeleted).toBe(true);
    
    // Verify telemetry anonymization
    expect(supabaseAdmin.from).toHaveBeenCalledWith('telemetry_events');
    expect(mockUpdate).toHaveBeenCalledWith({ user_id: null });
    
    // Verify orphan wipe occurred
    expect(supabaseAdmin.from).toHaveBeenCalledWith('chat_history');
    expect(supabaseAdmin.from).toHaveBeenCalledWith('audit_logs');
    expect(supabaseAdmin.from).toHaveBeenCalledWith('tombstones');
    expect(supabaseAdmin.from).toHaveBeenCalledWith('recovery_archive');

    // Verify all 34 static tables were targeted
    for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
      expect(supabaseAdmin.from).toHaveBeenCalledWith(item.table);
    }
  });

  it('safely isolates deletions to exactly the requested user ID (Cross-User Protection)', async () => {
    const userId = 'target-user-123';
    await accountLifecycleService.deleteAccount(userId);

    // Ensure we ONLY passed the exact user ID to the equality matchers
    const calls = mockEq.mock.calls;
    for (const call of calls) {
      // The second argument to eq() should be the userId
      expect(call[1]).toEqual(userId);
    }

    // Explicitly verify Supabase deleteUser was called with the target
    expect(supabaseAdmin.auth.admin.deleteUser).toHaveBeenCalledWith(userId);
    expect(supabaseAdmin.auth.admin.deleteUser).not.toHaveBeenCalledWith('some-other-user');
  });

  it('does not falsely report success if auth deletion fails (Atomicity)', async () => {
    (supabaseAdmin.auth.admin.deleteUser as jest.Mock).mockResolvedValue({ 
      error: new Error('Failed to delete auth user') 
    });

    const result = await accountLifecycleService.deleteAccount('user-123');
    
    expect(result.success).toBe(false);
    expect(result.authDeleted).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
  
  it('rejects empty or invalid user IDs', async () => {
    await expect(accountLifecycleService.deleteAccount('')).rejects.toThrow('invalid or empty userId');
    await expect(accountLifecycleService.deleteAccount('   ')).rejects.toThrow('invalid or empty userId');
    // @ts-ignore
    await expect(accountLifecycleService.deleteAccount(null)).rejects.toThrow('invalid or empty userId');
  });
});
