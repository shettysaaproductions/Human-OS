import { outboundDispatcherService } from '../OutboundDispatcherService';
import { supabaseAdmin } from '../../lib/supabase';
import { proactiveGate } from '../ProactiveGate';
import { sendNovaReplyNotification } from '../../lib/pushNotifications';
import { accountLifecycleService } from '../AccountLifecycleService';

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('../ProactiveGate', () => ({
  proactiveGate: {
    acquire: jest.fn(),
    commit: jest.fn(),
    release: jest.fn(),
  }
}));

jest.mock('../../lib/pushNotifications', () => ({
  sendNovaReplyNotification: jest.fn(),
}));

jest.mock('../AccountLifecycleService', () => ({
  accountLifecycleService: {
    deleteAccount: jest.fn(),
  }
}));

describe('OutboundDispatcherCrashRecovery', () => {
  let updateMock: jest.Mock;
  let selectMock: jest.Mock;
  let insertMock: jest.Mock;
  let eqMock: jest.Mock;
  let singleMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    eqMock = jest.fn().mockReturnThis();
    singleMock = jest.fn().mockResolvedValue({ data: null, error: null });
    updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    selectMock = jest.fn().mockReturnValue({ 
      eq: jest.fn().mockReturnValue({ 
        maybeSingle: singleMock, 
        single: singleMock, 
        limit: jest.fn().mockReturnThis() 
      }), 
      maybeSingle: singleMock, 
      single: singleMock, 
      limit: jest.fn().mockReturnThis() 
    });
    insertMock = jest.fn().mockResolvedValue({ error: null, data: null });
    insertMock.mockReturnValue({ select: selectMock, single: singleMock, then: (cb: any) => cb({ error: null, data: null }) });

    (supabaseAdmin.from as jest.Mock).mockReturnValue({
      select: selectMock,
      insert: insertMock,
      update: updateMock,
      delete: jest.fn().mockReturnThis(),
    });
    
    (proactiveGate.acquire as jest.Mock).mockResolvedValue({ allowed: true, outreachId: 'test-outreach' });
  });

  // 1. CREATED recovery
  it('TEST 1: Crash in CREATED (retry acquires gate and advances)', async () => {
    // Mock the uniqueness constraint failure
    insertMock.mockReturnValueOnce({
      select: jest.fn().mockReturnValueOnce({
        single: jest.fn().mockResolvedValueOnce({ error: { code: '23505' }, data: null })
      })
    });
    
    // Mock fetching the existing intent (state: CREATED)
    selectMock.mockReturnValueOnce({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'intent-1', status: 'CREATED', outreach_id: null, chat_message_id: null },
          })
        })
      })
    });
    
    // Mock tombstone check
    (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null }) }) })
    });
    
    (supabaseAdmin.from as jest.Mock).mockReturnValue({
      select: selectMock,
      insert: insertMock,
      update: updateMock,
    });
    
    await outboundDispatcherService.dispatch({
      userId: 'user-1',
      sourceEngine: 'Test',
      intentType: 'test',
      logicalKey: 'key',
      idempotencyKey: 'idemp-1',
      context: {},
      generationStrategy: 'none',
      proposedMessage: 'hello'
    });

    expect(proactiveGate.acquire).toHaveBeenCalledWith('user-1', expect.any(Object));
  });

  // 5. PERSISTED before Gate commit
  it('TEST 5: Crash after PERSISTED before Gate commit', async () => {
    insertMock.mockReturnValueOnce({
      select: jest.fn().mockReturnValueOnce({
        single: jest.fn().mockResolvedValueOnce({ error: { code: '23505' }, data: null })
      })
    });
    selectMock.mockReturnValueOnce({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'intent-1', status: 'PERSISTED', outreach_id: 'outreach-1', chat_message_id: 'chat-1' },
          })
        })
      })
    });

    // Mock tombstone check
    (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null }) }) })
    });

    // Mock chat fetch
    singleMock.mockResolvedValueOnce({ data: { content: 'hello' } }); 

    (supabaseAdmin.from as jest.Mock).mockReturnValue({
      select: selectMock,
      insert: insertMock,
      update: updateMock,
    });

    await outboundDispatcherService.dispatch({
      userId: 'user-1',
      sourceEngine: 'Test',
      intentType: 'test',
      logicalKey: 'key',
      idempotencyKey: 'idemp-1',
      context: {},
      generationStrategy: 'none',
      proposedMessage: 'hello'
    });

    expect(proactiveGate.commit).toHaveBeenCalledWith('outreach-1', 'hello');
    expect(sendNovaReplyNotification).toHaveBeenCalled();
  });
  
  // 8. account deletion
  it('TEST 8: Account deletion halts dispatch', async () => {
    // Mock tombstone check returning true
    (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: { user_id: 'user-1' } }) }) })
    });
    
    const status = await outboundDispatcherService.dispatch({
      userId: 'user-1',
      sourceEngine: 'Test',
      intentType: 'test',
      logicalKey: 'key',
      idempotencyKey: 'idemp-1',
      context: {},
      generationStrategy: 'none',
      proposedMessage: 'hello'
    });
    
    expect(status).toBe('FAILED_TERMINAL');
    expect(insertMock).not.toHaveBeenCalled();
  });
});
