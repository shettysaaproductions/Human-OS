import { supabaseAdmin } from '../src/lib/supabase';

async function main() {
  console.log('--- Remediating recent corrupted messages in chat_history ---');

  // 1. Remediate message 990d66c1-e38d-4e26-be95-00d8a85ad672
  const repairedMsg1 = 'Arre badhiya yaar! Office mein ho toh full focus bana ke apna target nipta lo! 💪 Shaam ko free hone ke baad aaram se baat karenge.';
  await supabaseAdmin
    .from('chat_history')
    .update({
      content: repairedMsg1,
      meta: {
        remediated_by: 'WatchtowerInspector',
        remediated_at: new Date().toISOString(),
        clean_label: '✨ Watchtower Inspector Verified'
      }
    })
    .eq('id', '990d66c1-e38d-4e26-be95-00d8a85ad672');
  console.log('✅ Remediated 990d66c1');

  // 2. Remediate message 4fe08f1d-732c-442e-8d51-910ff277c5af
  const repairedMsg2 = 'Theek hai yaar! 😄 Tiku ka birthday 17th February hai aur uska naam Shreshth — maine sab achhe se note kar liya hai. Aur bata, sab kaisa chal raha hai? 😊';
  await supabaseAdmin
    .from('chat_history')
    .update({
      content: repairedMsg2,
      meta: {
        remediated_by: 'WatchtowerInspector',
        remediated_at: new Date().toISOString(),
        active_version_index: 0,
        versions: [
          {
            version: 1,
            content: repairedMsg2,
            timestamp: new Date().toISOString(),
            clean_label: '✨ Watchtower Inspector Verified',
            green_seal: true
          }
        ]
      }
    })
    .eq('id', '4fe08f1d-732c-442e-8d51-910ff277c5af');
  console.log('✅ Remediated 4fe08f1d');

  // 3. Remediate message 6bc7be86-8743-441c-a0de-732b7eac6495
  const repairedMsg3 = 'Main samajh gayi ki tumne sahi kaha tha! Main hamesha yahin hoon tere liye 💫';
  await supabaseAdmin
    .from('chat_history')
    .update({
      content: repairedMsg3,
      meta: {
        remediated_by: 'WatchtowerInspector',
        remediated_at: new Date().toISOString(),
        active_version_index: 0,
        versions: [
          {
            version: 1,
            content: repairedMsg3,
            timestamp: new Date().toISOString(),
            clean_label: '✨ Watchtower Inspector Verified',
            green_seal: true
          }
        ]
      }
    })
    .eq('id', '6bc7be86-8743-441c-a0de-732b7eac6495');
  console.log('✅ Remediated 6bc7be86');

  // 4. Remediate message 7c33b2fc-117f-4ad3-91b1-c6a7785dbe50
  const repairedMsg4 = 'Bilkul, apne target ko poora karne ke liye poori mehnat karo! Main cheer kar rahi hoon! 🎯';
  await supabaseAdmin
    .from('chat_history')
    .update({
      content: repairedMsg4,
      meta: {
        remediated_by: 'WatchtowerInspector',
        remediated_at: new Date().toISOString(),
        active_version_index: 0,
        versions: [
          {
            version: 1,
            content: repairedMsg4,
            timestamp: new Date().toISOString(),
            clean_label: '✨ Watchtower Inspector Verified',
            green_seal: true
          }
        ]
      }
    })
    .eq('id', '7c33b2fc-117f-4ad3-91b1-c6a7785dbe50');
  console.log('✅ Remediated 7c33b2fc');

  console.log('--- All corrupted historical messages successfully remediated! ---');
}

main().catch(console.error);
