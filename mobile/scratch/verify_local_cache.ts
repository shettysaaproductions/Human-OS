// Standalone Diagnostics script for SQLite cache
import * as SQLite from 'expo-sqlite';

export async function runDiagnostics() {
  console.log('--- STARTING SQLITE CACHE DIAGNOSTICS ---');
  try {
    const db = await SQLite.openDatabaseAsync('human_os_chat.db');
    
    // 1. Get total message count
    const countResult: any = await db.getFirstAsync('SELECT COUNT(*) as count FROM messages;');
    console.log(`[SQLite Cache] Total Messages: ${countResult?.count}`);

    // 2. Get oldest and newest messages
    const bounds: any = await db.getFirstAsync(
      'SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM messages;'
    );
    console.log(`[SQLite Cache] Oldest Message Timestamp: ${bounds?.oldest}`);
    console.log(`[SQLite Cache] Newest Message Timestamp: ${bounds?.newest}`);

    // 3. Print user vs assistant breakdown
    const breakdown: any[] = await db.getAllAsync(
      'SELECT role, COUNT(*) as count FROM messages GROUP BY role;'
    );
    breakdown.forEach(row => {
      console.log(`[SQLite Cache] Role: ${row.role} -> ${row.count} messages`);
    });

    console.log('--- DIAGNOSTICS COMPLETE ---');
  } catch (error) {
    console.error('[SQLite Cache Diagnostics Failed]', error);
  }
}
