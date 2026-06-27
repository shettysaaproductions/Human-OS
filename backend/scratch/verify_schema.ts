import { supabaseAdmin } from '../src/lib/supabase';

async function checkColumns(tableName: string, requiredColumns: string[]) {
  const report: { table: string, missingColumns: string[], exists: boolean } = {
    table: tableName,
    missingColumns: [],
    exists: false
  };

  try {
    // Attempt to select 1 row to see if table exists
    const { error: tableError } = await supabaseAdmin.from(tableName).select('id').limit(1);
    
    if (tableError && tableError.code === '42P01') {
      return report; // exists = false
    }
    
    // If it's a different error, the table probably exists but something else went wrong,
    // or 'id' itself is missing. We'll assume the table exists.
    report.exists = true;

    // Check each column
    for (const col of requiredColumns) {
      const { error } = await supabaseAdmin.from(tableName).select(col).limit(1);
      
      if (error) {
        // 42703 is Postgres undefined_column. PGRST204/PGRST200 are PostgREST errors.
        if (error.code === '42703' || error.message.includes('Could not find') || error.message.includes('column')) {
          report.missingColumns.push(col);
        } else if (error.code !== 'PGRST116') { // Ignore "no rows" errors
          console.log(`[Warning] Unexpected error checking ${tableName}.${col}:`, error);
          // If it throws an error that's not "no rows", it might be missing
          report.missingColumns.push(col);
        }
      }
    }
  } catch (err: any) {
    console.error(`Fatal Error checking ${tableName}:`, err.message);
  }

  return report;
}

async function main() {
  const profilesReport = await checkColumns('profiles', ['id', 'onboarding_completed', 'companion_personality', 'created_at', 'updated_at']);
  const chatHistoryReport = await checkColumns('chat_history', ['id', 'user_id', 'role', 'content', 'created_at', 'conversation_id']);

  console.log('=== REPORT START ===');
  console.log(JSON.stringify({ profiles: profilesReport, chat_history: chatHistoryReport }, null, 2));
  console.log('=== REPORT END ===');
}

main().catch(console.error);
