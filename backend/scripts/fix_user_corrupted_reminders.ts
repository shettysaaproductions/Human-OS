import { supabaseAdmin } from '../src/lib/supabase';

const USER_ID = '62f9190b-1e1d-48d5-9667-12cd0bc3114b';

async function fixUserReminders() {
  console.log(`[Fix] Cleaning up corrupted reminders & followups for user: ${USER_ID}`);

  // 1. Cancel wrong September 24 birthday reminders
  const { data: cancelledRows, error: cErr } = await supabaseAdmin
    .from('reminders')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('user_id', USER_ID)
    .in('id', [
      '97068fbe-239c-4bc3-950d-2ed40c00fa08',
      'a378e1ff-d0c4-4c11-adfb-d90bd509e296'
    ])
    .select('id, text, trigger_at, status');

  if (cErr) {
    console.error('[Fix] Error cancelling wrong reminders:', cErr.message);
  } else {
    console.log('[Fix] Cancelled wrong reminders:', cancelledRows);
  }

  // 2. Cancel any pending followups about birthday/gift
  const { data: cancelledFollowups, error: fErr } = await supabaseAdmin
    .from('nova_followups')
    .update({ status: 'cancelled' })
    .eq('user_id', USER_ID)
    .eq('status', 'pending')
    .select('id, message, status');

  if (fErr) {
    console.error('[Fix] Error cancelling pending followups:', fErr.message);
  } else {
    console.log('[Fix] Cancelled pending followups:', cancelledFollowups);
  }

  // 3. Check if correct July 23, 2027 reminder already exists
  const { data: existingCorrect } = await supabaseAdmin
    .from('reminders')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('status', 'active')
    .gte('trigger_at', '2027-07-23T00:00:00Z')
    .lte('trigger_at', '2027-07-23T23:59:59Z');

  if (existingCorrect && existingCorrect.length > 0) {
    console.log('[Fix] Correct reminder already exists:', existingCorrect[0]);
  } else {
    // Insert the correct yearly reminder: July 23, 2027 at 10:00 AM IST (04:30:00 UTC)
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('reminders')
      .insert({
        user_id: USER_ID,
        text: 'Wife ke birthday gift ke lie (15 din pehle)',
        trigger_at: '2027-07-23T04:30:00.000Z',
        recurrence_type: 'years',
        recurrence_interval: 1,
        status: 'active',
        is_auto: false,
        created_at: new Date().toISOString()
      })
      .select('*')
      .single();

    if (insErr) {
      console.error('[Fix] Error inserting correct reminder:', insErr.message);
    } else {
      console.log('[Fix] Successfully created correct yearly reminder:', inserted);
    }
  }

  console.log('[Fix] Completed database remediation.');
}

fixUserReminders().catch(console.error);
