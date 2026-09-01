import { supabaseAdmin } from '../src/lib/supabase';
import { AccountLifecycleService } from '../src/services/AccountLifecycleService';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TARGET_EMAIL = 'admin@recrutos.com';

async function audit() {
  console.log('============================================================');
  console.log('READ-ONLY FORENSIC AUDIT AFTER SHOOT DEAD');
  console.log('============================================================\n');

  // 1. Check auth.users
  const { data: usersData, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
  if (usersError) {
    console.error('Error listing auth users:', usersError);
  }
  
  const allUsers = usersData?.users || [];
  console.log(`Total Auth Users Found: ${allUsers.length}`);
  allUsers.forEach(u => {
    console.log(`- User ID: ${u.id}, Email: ${u.email}, Created: ${u.created_at}, Last Sign In: ${u.last_sign_in_at}`);
  });

  const targetAuthUser = allUsers.find(u => u.email?.toLowerCase() === TARGET_EMAIL.toLowerCase());
  console.log(`\nTarget User (${TARGET_EMAIL}) exists in auth.users: ${targetAuthUser ? 'YES' : 'NO'}`);

  // 2. Find any recently active user IDs from telemetry_events, or other tables
  let recentUserIds: string[] = [];
  try {
    const { data: telemetry } = await supabaseAdmin
      .from('telemetry_events')
      .select('event_type, created_at, metadata')
      .order('created_at', { ascending: false })
      .limit(20);
    console.log('\nRecent Telemetry Events:');
    telemetry?.forEach(t => {
      console.log(`  [${t.created_at}] ${t.event_type}: ${JSON.stringify(t.metadata)}`);
    });
  } catch (e: any) {
    console.log('Error reading telemetry_events:', e.message);
  }

  // Also check if any table in the DB has rows with any user_id
  console.log('\nChecking all user-owned tables for ANY remaining rows...');
  const tableSummary: Record<string, { totalRows: number; userRows: Record<string, number> }> = {};

  for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
    try {
      const { data, count, error } = await supabaseAdmin
        .from(item.table)
        .select(`${item.userColumn}`, { count: 'exact' });
      
      const rowCount = count ?? (data?.length || 0);
      const userDistribution: Record<string, number> = {};
      if (data) {
        data.forEach((r: any) => {
          const uid = r[item.userColumn] || 'null/unassigned';
          userDistribution[uid] = (userDistribution[uid] || 0) + 1;
        });
      }
      tableSummary[item.table] = {
        totalRows: rowCount,
        userRows: userDistribution
      };
    } catch (e: any) {
      console.error(`Error querying table ${item.table}:`, e.message);
    }
  }

  console.log('\n--- User-Owned Table Summary ---');
  for (const [tbl, info] of Object.entries(tableSummary)) {
    if (info.totalRows > 0) {
      console.log(`⚠️ ${tbl}: ${info.totalRows} total rows ->`, JSON.stringify(info.userRows));
    } else {
      console.log(`✅ ${tbl}: 0 rows`);
    }
  }

  // 3. Check Orphan Tables
  console.log('\n--- Orphan Tables Check ---');
  try {
    const { count: auditCount } = await supabaseAdmin.from('audit_logs').select('*', { count: 'exact', head: true });
    console.log(`audit_logs total rows: ${auditCount || 0}`);
  } catch (e: any) {
    console.log('audit_logs check:', e.message);
  }

  try {
    const { count: tombCount } = await supabaseAdmin.from('tombstones').select('*', { count: 'exact', head: true });
    console.log(`tombstones total rows: ${tombCount || 0}`);
  } catch (e: any) {
    console.log('tombstones check:', e.message);
  }

  try {
    const { data: recData, count: recCount } = await supabaseAdmin.from('recovery_archive').select('id, original_payload', { count: 'exact' });
    console.log(`recovery_archive total rows: ${recCount || 0}`);
    if (recData && recData.length > 0) {
      console.log('recovery_archive samples:', recData.map(r => ({ id: r.id, user_id: (r.original_payload as any)?.user_id })));
    }
  } catch (e: any) {
    console.log('recovery_archive check:', e.message);
  }

  // 4. Check other users
  const otherUsers = allUsers.filter(u => u.email?.toLowerCase() !== TARGET_EMAIL.toLowerCase());
  console.log(`\nOther Users in auth.users: ${otherUsers.length}`);
  otherUsers.forEach(u => console.log(`  - ${u.id} (${u.email})`));

  // 5. Check Health Endpoints
  console.log('\n--- Health Endpoints ---');
  try {
    const h1 = await fetch('http://localhost:5001/health').then(r => r.json()).catch(e => ({ error: e.message }));
    console.log('/health:', JSON.stringify(h1));
  } catch (e: any) {
    console.log('/health unreachable:', e.message);
  }

  try {
    const h2 = await fetch('http://localhost:5001/health/ready').then(r => r.json()).catch(e => ({ error: e.message }));
    console.log('/health/ready:', JSON.stringify(h2));
  } catch (e: any) {
    console.log('/health/ready unreachable:', e.message);
  }
}

audit().catch(console.error);
