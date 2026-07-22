import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import { chatService } from './chatService';
import * as SecureStore from 'expo-secure-store';

const QUEUE_KEY = 'humanOs_pendingQueue';
const NOVA_QUEUE_FLUSH_TASK = 'NOVA_QUEUE_FLUSH_TASK';

// Define the background task. This MUST be defined in the global scope.
TaskManager.defineTask(NOVA_QUEUE_FLUSH_TASK, async () => {
  try {
    console.log('[BACKGROUND_FETCH] Running queue flush task...');
    
    // 1. Load pending queue from SecureStore
    const rawQueue = await SecureStore.getItemAsync(QUEUE_KEY);
    if (!rawQueue) return BackgroundFetch.BackgroundFetchResult.NoData;
    
    const pendingQueue: { id: string; content: string; replyToId?: string; replyToContent?: string }[] = JSON.parse(rawQueue);
    
    if (pendingQueue.length === 0) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // 2. Load delivered IDs to deduplicate
    const rawDelivered = await SecureStore.getItemAsync('humanOs_deliveredIds');
    const deliveredArr: { id: string; ts: number }[] = rawDelivered ? JSON.parse(rawDelivered) : [];
    const deliveredIds = new Set(deliveredArr.map(e => e.id));

    const toProcess = pendingQueue.filter(q => !deliveredIds.has(q.id));

    if (toProcess.length === 0) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    console.log(`[BACKGROUND_FETCH] Flushing ${toProcess.length} items`);

    let anySuccess = false;

    // 3. Process items
    for (const item of toProcess) {
      try {
        await chatService.sendMessageAsync(item.content, undefined, item.replyToId, item.replyToContent);
        // Mark as delivered
        deliveredArr.push({ id: item.id, ts: Date.now() });
        anySuccess = true;
      } catch (err) {
        console.warn(`[BACKGROUND_FETCH] Failed to send item ${item.id}:`, err);
      }
    }

    if (anySuccess) {
      // Keep last 100
      const newDelivered = deliveredArr.slice(-100);
      await SecureStore.setItemAsync('humanOs_deliveredIds', JSON.stringify(newDelivered));
      // Note: We don't remove from the pending queue here to avoid race conditions with the UI.
      // The UI will drop them when it sees they are in deliveredIds.
      return BackgroundFetch.BackgroundFetchResult.NewData;
    }

    return BackgroundFetch.BackgroundFetchResult.Failed;

  } catch (error) {
    console.error('[BACKGROUND_FETCH] Error:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// Function to register the task (called in App startup)
export async function registerBackgroundFetchAsync() {
  try {
    await BackgroundFetch.registerTaskAsync(NOVA_QUEUE_FLUSH_TASK, {
      minimumInterval: 15 * 60, // 15 minutes
      stopOnTerminate: false, // android only,
      startOnBoot: true, // android only
    });
    console.log('[BACKGROUND_FETCH] Task registered');
  } catch (err) {
    console.log('[BACKGROUND_FETCH] Failed to register task:', err);
  }
}

export async function unregisterBackgroundFetchAsync() {
  try {
    await BackgroundFetch.unregisterTaskAsync(NOVA_QUEUE_FLUSH_TASK);
  } catch (err) {
    console.log('[BACKGROUND_FETCH] Failed to unregister task:', err);
  }
}
