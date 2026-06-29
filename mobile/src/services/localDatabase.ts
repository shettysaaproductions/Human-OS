import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export const localDatabase = {
  initDB: async (): Promise<SQLite.SQLiteDatabase> => {
    if (!db) {
      db = await SQLite.openDatabaseAsync('human_os_chat.db');
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          status TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          errorMessage TEXT
        );
      `);
    }
    return db;
  },

  getMessages: async (): Promise<any[]> => {
    const database = await localDatabase.initDB();
    return await database.getAllAsync('SELECT * FROM messages ORDER BY timestamp ASC;');
  },

  saveMessages: async (messages: any[]): Promise<void> => {
    const database = await localDatabase.initDB();
    await database.withTransactionAsync(async () => {
      for (const msg of messages) {
        await database.runAsync(
          `INSERT OR REPLACE INTO messages (id, role, content, status, timestamp, errorMessage)
           VALUES (?, ?, ?, ?, ?, ?);`,
          [
            msg.id,
            msg.role,
            msg.content,
            msg.status || 'sent',
            msg.timestamp || new Date().toISOString(),
            msg.errorMessage || null
          ]
        );
      }
    });
  },

  clearMessages: async (): Promise<void> => {
    const database = await localDatabase.initDB();
    await database.runAsync('DELETE FROM messages;');
  }
};
