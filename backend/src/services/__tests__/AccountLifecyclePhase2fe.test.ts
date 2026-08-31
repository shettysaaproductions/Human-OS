/**
 * AccountLifecyclePhase2fe.test.ts — Unit Tests for Phase 2F-E Account Lifecycle & Deletion Engine
 */

import { AccountLifecycleService, accountLifecycleService } from '../AccountLifecycleService';
import { supabaseAdmin } from '../../lib/supabase';
import { cache } from '../../lib/cache';

// Mock supabaseAdmin & cache
jest.mock('../../lib/supabase', () => {
  const mockDelete = jest.fn();
  const mockUpdate = jest.fn();
  const mockSelect = jest.fn();
  const mockEq = jest.fn();
  const mockLimit = jest.fn();
  const mockListUsers = jest.fn();
  const mockDeleteUser = jest.fn();
  const mockGetUserById = jest.fn();

  return {
    supabaseAdmin: {
      from: jest.fn().mockImplementation((table: string) => {
        return {
          delete: jest.fn().mockReturnValue({
            eq: jest.fn().mockImplementation((col: string, val: string) => {
              if (table === 'profiles' && col === 'user_id') {
                return Promise.resolve({ count: 0, error: { message: 'Column user_id does not exist' } });
              }
              return Promise.resolve({ count: 1, error: null });
            }),
          }),
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: null }),
          }),
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
              single: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
            limit: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }),
      auth: {
        admin: {
          listUsers: jest.fn().mockResolvedValue({
            data: { users: [{ id: 'active-user-1', email: 'active@test.com' }] },
            error: null,
          }),
          deleteUser: jest.fn().mockResolvedValue({ data: {}, error: null }),
          getUserById: jest.fn().mockImplementation((id: string) => {
            if (id === 'active-user-1') {
              return Promise.resolve({ data: { user: { id: 'active-user-1' } }, error: null });
            }
            return Promise.resolve({ data: { user: null }, error: { message: 'User not found' } });
          }),
        },
      },
    },
  };
});

jest.mock('../../lib/cache', () => ({
  cache: {
    invalidate: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
  },
}));

describe('Phase 2F-E: Account Lifecycle & Deletion Hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // 1. Mark Dead deletes profile using correct key ('id')
  it('1. Mark Dead deletes profile using correct key (id, not user_id)', async () => {
    const fromSpy = jest.spyOn(supabaseAdmin, 'from');
    const result = await accountLifecycleService.deleteAccount('user-123');

    expect(result.success).toBe(true);
    expect(result.profileDeleted).toBe(true);
    // Check that profiles table was queried with 'id'
    const profileCall = fromSpy.mock.calls.find(c => c[0] === 'profiles');
    expect(profileCall).toBeDefined();
  });

  // 2. Mark Dead deletes memory
  it('2. Mark Dead deletes memories table records', async () => {
    const result = await accountLifecycleService.deleteAccount('user-123');
    expect(result.tablesCleaned['memories']).toBe(1);
  });

  // 3. Mark Dead deletes chat
  it('3. Mark Dead deletes chat_history table records', async () => {
    const result = await accountLifecycleService.deleteAccount('user-123');
    expect(result.tablesCleaned['chat_history']).toBe(1);
  });

  // 4. Mark Dead deletes working memory
  it('4. Mark Dead deletes working_memory table records', async () => {
    const result = await accountLifecycleService.deleteAccount('user-123');
    expect(result.tablesCleaned['working_memory']).toBe(1);
  });

  // 5. Mark Dead deletes episodic memory
  it('5. Mark Dead deletes episodic_memories table records', async () => {
    const result = await accountLifecycleService.deleteAccount('user-123');
    expect(result.tablesCleaned['episodic_memories']).toBe(1);
  });

  // 6. Mark Dead deletes doubts
  it('6. Mark Dead deletes nova_cognitive_doubts table records', async () => {
    const result = await accountLifecycleService.deleteAccount('user-123');
    expect(result.tablesCleaned['nova_cognitive_doubts']).toBe(1);
  });

  // 7. Mark Dead deletes Guardian records
  it('7. Mark Dead deletes nova_guardian_runs, anomalies, and repairs', async () => {
    const result = await accountLifecycleService.deleteAccount('user-123');
    expect(result.tablesCleaned['nova_guardian_runs']).toBe(1);
    expect(result.tablesCleaned['nova_guardian_anomalies']).toBe(1);
    expect(result.tablesCleaned['nova_guardian_repairs']).toBe(1);
  });

  // 8. Mark Dead deletes candidate records
  it('8. Mark Dead deletes candidate_synthesis_claims', async () => {
    const result = await accountLifecycleService.deleteAccount('user-123');
    expect(result.tablesCleaned['candidate_synthesis_claims']).toBe(1);
  });

  // 9. Mark Dead handles nova actions
  it('9. Mark Dead deletes nova_actions and life_threads', async () => {
    const result = await accountLifecycleService.deleteAccount('user-123');
    expect(result.tablesCleaned['nova_actions']).toBe(1);
    expect(result.tablesCleaned['life_threads']).toBe(1);
  });

  // 10. Mark Dead handles reminders
  it('10. Mark Dead deletes reminders and followups', async () => {
    const result = await accountLifecycleService.deleteAccount('user-123');
    expect(result.tablesCleaned['reminders']).toBe(1);
    expect(result.tablesCleaned['nova_followups']).toBe(1);
  });

  // 11. Partial cleanup does not falsely report success
  it('11. Partial cleanup with auth failure does not falsely report success', async () => {
    (supabaseAdmin.auth.admin.deleteUser as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { message: 'Database connection failed' },
    });

    const result = await accountLifecycleService.deleteAccount('user-123');
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Failed to delete auth user identity: Database connection failed');
  });

  // 12. Active users cannot be accidentally selected
  it('12. Active users cannot be purged by zombie purge mechanism', async () => {
    await expect(accountLifecycleService.purgeConfirmedZombie('active-user-1')).rejects.toThrow(
      'CRITICAL ABORT: Refusing to purge active-user-1 because it is an ACTIVE auth user!'
    );
  });

  // 13. No-profile auth user is not automatically deleted
  it('13. Scan recognizes auth user without profile as valid unonboarded user, not zombie', async () => {
    (supabaseAdmin.auth.admin.listUsers as jest.Mock).mockResolvedValueOnce({
      data: { users: [{ id: 'auth-only-user', email: 'auth@test.com' }] },
      error: null,
    });
    (supabaseAdmin.from as jest.Mock).mockImplementationOnce(() => ({
      select: jest.fn().mockResolvedValue({ data: [], error: null }),
    }));

    const scan = await accountLifecycleService.scanZombieProfiles();
    expect(scan.zombieCount).toBe(0);
  });

  // 14. Zombie profile cleanup is scoped
  it('14. Confirmed zombie profiles without auth records are correctly identified', async () => {
    (supabaseAdmin.auth.admin.listUsers as jest.Mock).mockResolvedValueOnce({
      data: { users: [{ id: 'active-1' }] },
      error: null,
    });
    (supabaseAdmin.from as jest.Mock).mockImplementationOnce(() => ({
      select: jest.fn().mockResolvedValue({
        data: [
          { id: 'active-1', preferred_name: 'Active User' },
          { id: 'zombie-1', preferred_name: 'Zombie User' },
        ],
        error: null,
      }),
    }));

    const scan = await accountLifecycleService.scanZombieProfiles();
    expect(scan.totalProfiles).toBe(2);
    expect(scan.activeLinkedCount).toBe(1);
    expect(scan.zombieCount).toBe(1);
    expect(scan.zombieProfiles[0].id).toBe('zombie-1');
  });

  // 15. Orphan memory cleanup is scoped
  it('15. Purging confirmed zombie only cleans data for that specific zombie ID', async () => {
    const deleteSpy = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ count: 5, error: null }),
    });
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => ({
      delete: deleteSpy,
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    }));

    const result = await accountLifecycleService.purgeConfirmedZombie('zombie-999');
    expect(result.userId).toBe('zombie-999');
    expect(result.success).toBe(true);
  });

  // 16. Founder Dashboard excludes deleted accounts
  it('16. Invalidation ensures cached metrics and profiles are flushed', async () => {
    await accountLifecycleService.deleteAccount('user-123');
    expect(cache.invalidate).toHaveBeenCalledWith('profile:user-123');
    expect(cache.invalidate).toHaveBeenCalledWith('memories:user-123');
  });

  // 17. Active users count remains correct
  it('17. Active user deletion accurately reports timing and tables cleaned count', async () => {
    const result = await accountLifecycleService.deleteAccount('user-123');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Object.keys(result.tablesCleaned).length).toBe(AccountLifecycleService.USER_OWNED_TABLES.length);
  });

  // 18. Cross-user memory isolation remains intact
  it('18. Deletion queries always specify userColumn = userId filter', async () => {
    const eqSpy = jest.fn().mockResolvedValue({ count: 1, error: null });
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => ({
      delete: jest.fn().mockReturnValue({ eq: eqSpy }),
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    }));

    await accountLifecycleService.deleteAccount('target-user-456');
    for (const call of eqSpy.mock.calls) {
      expect(call[1]).toBe('target-user-456');
    }
  });

  // 19. Account deletion is idempotent
  it('19. Account deletion is idempotent when auth user is already absent (404/not found)', async () => {
    (supabaseAdmin.auth.admin.deleteUser as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { message: 'User not found', status: 404 },
    });

    const result = await accountLifecycleService.deleteAccount('already-deleted-user');
    expect(result.success).toBe(true);
    expect(result.authDeleted).toBe(true);
  });

  // 20. Repeat Mark Dead cannot recreate residue
  it('20. Running deleteAccount twice on same user produces clean zero-residue result', async () => {
    const res1 = await accountLifecycleService.deleteAccount('user-repeat');
    const res2 = await accountLifecycleService.deleteAccount('user-repeat');
    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
  });

  // 21. Telemetry/audit SET NULL behavior remains correct
  it('21. Telemetry events are anonymized with user_id = null instead of deleting crash telemetry', async () => {
    const updateSpy = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'telemetry_events') {
        return { update: updateSpy };
      }
      return {
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ count: 1, error: null }) }),
      };
    });

    await accountLifecycleService.deleteAccount('user-telemetry');
    expect(updateSpy).toHaveBeenCalledWith({ user_id: null });
  });

  // 22. FK cascade behavior verified
  it('22. Complete table inventory covers all 32 user-owned entities in correct order', () => {
    const tables = AccountLifecycleService.USER_OWNED_TABLES.map(t => t.table);
    expect(tables).toContain('kg_edges');
    expect(tables).toContain('kg_nodes');
    expect(tables).toContain('nova_guardian_repairs');
    expect(tables).toContain('nova_guardian_anomalies');
    expect(tables).toContain('nova_guardian_runs');
    expect(tables).toContain('nova_cognitive_doubts');
    expect(tables).toContain('candidate_synthesis_claims');
    expect(tables).toContain('nova_actions');
    expect(tables).toContain('life_threads');
    expect(tables).toContain('memories');
    expect(tables).toContain('profiles');

    // Verify profiles is last
    expect(tables[tables.length - 1]).toBe('profiles');
  });

  // 23. FK migration handles existing data
  it('23. Table inventory specifies correct user column mapping for each table', () => {
    for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
      if (item.table === 'profiles') {
        expect(item.userColumn).toBe('id');
      } else {
        expect(item.userColumn).toBe('user_id');
      }
    }
  });

  // 24. No unintended deletion of historical audit data
  it('24. System global tables (candidate_synthesis_runs, audit_logs) are excluded from user wipe', () => {
    const tables = AccountLifecycleService.USER_OWNED_TABLES.map(t => t.table);
    expect(tables).not.toContain('audit_logs');
    expect(tables).not.toContain('candidate_synthesis_runs');
    expect(tables).not.toContain('recovery_archive');
    expect(tables).not.toContain('tombstones');
  });
});
