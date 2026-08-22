const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const outputHtmlPath = path.join(__dirname, '..', 'Technical_Details_About_Human_OS.html');
const outputPdfPath = path.join(__dirname, '..', 'Technical_Details_About_Human_OS.pdf');

console.log('Generating beginner-friendly, visual N8N blueprint for Human OS...');

// Helper to draw clean SVG bezier wires with clear labels
function drawWire(x1, y1, x2, y2, color = '#00e5ff', label = '', labelPos = 0.5) {
  const dx = Math.abs(x2 - x1) * 0.45;
  const cx1 = x1 + dx;
  const cy1 = y1;
  const cx2 = x2 - dx;
  const cy2 = y2;
  const pathD = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;

  const mx = x1 + (x2 - x1) * labelPos;
  const my = y1 + (y2 - y1) * labelPos;

  let labelSvg = '';
  if (label) {
    const textWidth = Math.max(label.length * 6.8 + 16, 55);
    labelSvg = `
      <g transform="translate(${mx}, ${my})">
        <rect x="${-textWidth/2}" y="-10" width="${textWidth}" height="20" rx="10" fill="#131722" stroke="${color}" stroke-width="1.2"/>
        <text x="0" y="3.5" fill="#f0f6fc" font-size="9" font-family="'Segoe UI', Arial, sans-serif" font-weight="700" text-anchor="middle">${label}</text>
      </g>
    `;
  }

  return `
    <g>
      <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2.5" stroke-opacity="0.9"/>
      <path d="${pathD}" fill="none" stroke="#ffffff" stroke-width="1" stroke-opacity="0.7" stroke-dasharray="4 6"/>
      <circle cx="${x1}" cy="${y1}" r="4.5" fill="${color}" stroke="#ffffff" stroke-width="1"/>
      <circle cx="${x2}" cy="${y2}" r="4.5" fill="${color}" stroke="#ffffff" stroke-width="1"/>
      ${labelSvg}
    </g>
  `;
}

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Technical Details About Human OS — Visual Guide & Workflow</title>
<style>
  @page {
    size: A4 landscape;
    margin: 0;
  }
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  body {
    background-color: #0b0f19;
    color: #e6edf3;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page {
    width: 297mm;
    height: 210mm;
    page-break-after: always;
    position: relative;
    overflow: hidden;
    background: #0b0f19;
    background-image: 
      radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.06) 1px, transparent 0),
      radial-gradient(ellipse at 90% 10%, rgba(124, 77, 255, 0.1) 0%, transparent 40%),
      radial-gradient(ellipse at 10% 90%, rgba(0, 229, 255, 0.08) 0%, transparent 40%);
    background-size: 22px 22px, 100% 100%, 100% 100%;
    display: flex;
    flex-direction: column;
    padding: 12mm 15mm 10mm 15mm;
  }

  /* Header */
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1.5px solid rgba(255, 255, 255, 0.12);
    padding-bottom: 7px;
    margin-bottom: 10px;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .badge-tag {
    background: linear-gradient(135deg, #ff7b00, #ff4081);
    color: #fff;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.8px;
    padding: 4px 8px;
    border-radius: 6px;
    text-transform: uppercase;
  }
  .page-title {
    font-size: 18px;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: -0.3px;
  }
  .page-subtitle {
    font-size: 11px;
    color: #94a3b8;
    font-weight: 500;
    margin-top: 1px;
  }
  .header-badges {
    display: flex;
    gap: 8px;
  }
  .pill {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    font-size: 10px;
    padding: 3px 8px;
    border-radius: 4px;
    color: #cbd5e1;
  }
  .pill strong {
    color: #38bdf8;
  }

  /* Canvas area for N8N Workflow */
  .canvas-area {
    position: relative;
    flex: 1;
    width: 100%;
    min-height: 0;
    border-radius: 10px;
    background: #111726;
    border: 1px solid rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }

  .canvas-svg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2;
  }

  /* Node Cards (N8N Style) */
  .node {
    position: absolute;
    border-radius: 8px;
    background: #182234;
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
    z-index: 3;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .node-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 9px;
    font-size: 10px;
    font-weight: 700;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .node-header-title {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .node-icon {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 800;
  }
  .node-role-tag {
    font-size: 8px;
    padding: 1.5px 5px;
    border-radius: 8px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .node-name {
    font-size: 12px;
    font-weight: 800;
    color: #ffffff;
    padding: 6px 9px 2px 9px;
  }
  .node-file-tag {
    font-size: 9px;
    font-family: Consolas, monospace;
    color: #38bdf8;
    padding: 0 9px 5px 9px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .node-body {
    padding: 5px 9px 7px 9px;
    font-size: 9.5px;
    line-height: 1.35;
    color: #cbd5e1;
    flex: 1;
  }
  .node-body p {
    margin-bottom: 3px;
  }
  .node-body strong {
    color: #ffffff;
  }

  /* Node Colors */
  .node-orange { border-top: 3px solid #ff7b00; }
  .node-orange .node-header { background: rgba(255, 123, 0, 0.15); color: #ff9e3b; }
  .node-orange .node-icon { background: #ff7b00; color: #fff; }
  .node-orange .node-role-tag { background: rgba(255, 123, 0, 0.3); color: #ffd8a8; }

  .node-cyan { border-top: 3px solid #00e5ff; }
  .node-cyan .node-header { background: rgba(0, 229, 255, 0.15); color: #38bdf8; }
  .node-cyan .node-icon { background: #0284c7; color: #fff; }
  .node-cyan .node-role-tag { background: rgba(0, 229, 255, 0.3); color: #bae6fd; }

  .node-purple { border-top: 3px solid #a855f7; }
  .node-purple .node-header { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
  .node-purple .node-icon { background: #9333ea; color: #fff; }
  .node-purple .node-role-tag { background: rgba(168, 85, 247, 0.3); color: #e9d5ff; }

  .node-green { border-top: 3px solid #10b981; }
  .node-green .node-header { background: rgba(16, 185, 129, 0.15); color: #34d399; }
  .node-green .node-icon { background: #059669; color: #fff; }
  .node-green .node-role-tag { background: rgba(16, 185, 129, 0.3); color: #a7f3d0; }

  .node-yellow { border-top: 3px solid #eab308; }
  .node-yellow .node-header { background: rgba(234, 179, 8, 0.15); color: #facc15; }
  .node-yellow .node-icon { background: #ca8a04; color: #fff; }
  .node-yellow .node-role-tag { background: rgba(234, 179, 8, 0.3); color: #fef08a; }

  .node-pink { border-top: 3px solid #ec4899; }
  .node-pink .node-header { background: rgba(236, 72, 153, 0.15); color: #f472b6; }
  .node-pink .node-icon { background: #db2777; color: #fff; }
  .node-pink .node-role-tag { background: rgba(236, 72, 153, 0.3); color: #fbcfe8; }

  .node-blue { border-top: 3px solid #3b82f6; }
  .node-blue .node-header { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
  .node-blue .node-icon { background: #2563eb; color: #fff; }
  .node-blue .node-role-tag { background: rgba(59, 130, 246, 0.3); color: #bfdbfe; }

  /* Pins */
  .pin-l, .pin-r {
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ffffff;
    border: 2px solid #111726;
    top: 50%;
    transform: translateY(-50%);
    z-index: 10;
  }
  .pin-l { left: -4px; }
  .pin-r { right: -4px; }

  /* Bottom Explanatory Panel */
  .bottom-box {
    margin-top: 8px;
    display: grid;
    grid-template-columns: 1.2fr 1.5fr 1.3fr;
    gap: 8px;
    background: #141c2c;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 8px 12px;
  }
  .box-col h3 {
    font-size: 10px;
    font-weight: 800;
    color: #38bdf8;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 2px;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .box-col p {
    font-size: 9.5px;
    line-height: 1.35;
    color: #94a3b8;
  }
  .box-col p strong {
    color: #f1f5f9;
  }
  .upgrade-pill {
    background: rgba(168, 85, 247, 0.2);
    border-left: 2.5px solid #a855f7;
    padding: 3px 6px;
    border-radius: 0 4px 4px 0;
    font-family: Consolas, monospace;
    font-size: 9px;
    color: #e9d5ff;
    margin-top: 2px;
  }

  /* Footer */
  .page-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 5px;
    font-size: 9px;
    color: #64748b;
    font-family: Consolas, monospace;
  }
</style>
</head>
<body>

<!-- ========================================================================= -->
<!-- PAGE 1: MASTER SYSTEM BLUEPRINT                                           -->
<!-- ========================================================================= -->
<div class="page" id="page-1">
  <div class="page-header">
    <div class="header-left">
      <span class="badge-tag">Page 1 • Master Map</span>
      <div>
        <h1 class="page-title">Technical Details About Human OS: Master Workflow Map</h1>
        <p class="page-subtitle">A beginner-friendly visual blueprint of how the phone, server, AI brain, memories, and notifications talk to each other</p>
      </div>
    </div>
    <div class="header-badges">
      <span class="pill">Concept: <strong>Living Mind</strong></span>
      <span class="pill">Backend: <strong>Render (Node.js)</strong></span>
      <span class="pill">Database: <strong>Supabase Postgres</strong></span>
    </div>
  </div>

  <div class="canvas-area">
    <svg class="canvas-svg" viewBox="0 0 1020 440">
      ${drawWire(150, 75, 230, 75, '#00e5ff', '1. User Text', 0.5)}
      ${drawWire(390, 75, 470, 75, '#a855f7', '2. Fast 202 Ack + Mutex', 0.5)}
      ${drawWire(630, 75, 710, 75, '#eab308', '3. Key 1 (Frontal)', 0.5)}
      ${drawWire(630, 115, 710, 215, '#10b981', '4. Fetch Facts', 0.5)}
      ${drawWire(860, 75, 890, 150, '#ec4899', '5. Multi-Bubble', 0.5)}
      ${drawWire(860, 215, 890, 240, '#ec4899', '6. FCM Push', 0.5)}
      ${drawWire(890, 190, 150, 250, '#ec4899', '7. Lock Screen Alert', 0.5)}
      ${drawWire(150, 230, 230, 230, '#3b82f6', '8. 15m Pulse', 0.5)}
      ${drawWire(390, 230, 470, 230, '#a855f7', '9. Check In', 0.5)}
    </svg>

    <!-- Node 1: Mobile Phone -->
    <div class="node node-orange" style="left: 10px; top: 20px; width: 140px; height: 125px;">
      <div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title">
          <div class="node-icon">📱</div>
          <span>The Phone</span>
        </div>
        <span class="node-role-tag">CLIENT</span>
      </div>
      <div class="node-name">React Native App</div>
      <div class="node-file-tag">com.humanos.mobile</div>
      <div class="node-body">
        <p>• The app in your hand.</p>
        <p>• Sends messages, images, & user activity.</p>
        <p>• Renders WhatsApp bubbles.</p>
      </div>
    </div>

    <!-- Node 1B: Push Receiver -->
    <div class="node node-pink" style="left: 10px; top: 180px; width: 140px; height: 125px;">
      <div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title">
          <div class="node-icon">🔔</div>
          <span>Push Receiver</span>
        </div>
        <span class="node-role-tag">FCM V1</span>
      </div>
      <div class="node-name">Notification Engine</div>
      <div class="node-file-tag">usePushNotifications.ts</div>
      <div class="node-body">
        <p>• Receives alerts even when app is CLOSED.</p>
        <p>• Wakes phone for reminders.</p>
      </div>
    </div>

    <!-- Node 2: Server Gateway -->
    <div class="node node-cyan" style="left: 230px; top: 20px; width: 160px; height: 135px;">
      <div class="pin-l"></div>
      <div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title">
          <div class="node-icon">🚪</div>
          <span>The Receptionist</span>
        </div>
        <span class="node-role-tag">EXPRESS GATEWAY</span>
      </div>
      <div class="node-name">API & Mutex Lock</div>
      <div class="node-file-tag">backend/src/routes/chat.ts</div>
      <div class="node-body">
        <p>• <strong>Instant 202 Receipt:</strong> Screen never freezes.</p>
        <p>• <strong>Debounce:</strong> Merges rapid texts into 1 reply.</p>
      </div>
    </div>

    <!-- Node 2B: Heartbeat Clock -->
    <div class="node node-blue" style="left: 230px; top: 180px; width: 160px; height: 135px;">
      <div class="pin-l"></div>
      <div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title">
          <div class="node-icon">⏰</div>
          <span>The Alarm Clock</span>
        </div>
        <span class="node-role-tag">LIFE CRON</span>
      </div>
      <div class="node-name">Heartbeat Schedulers</div>
      <div class="node-file-tag">backend/src/index.ts</div>
      <div class="node-body">
        <p>• <strong>15m:</strong> Nova wakes to check on you (NACE).</p>
        <p>• <strong>30s:</strong> Fired reminders.</p>
        <p>• <strong>2-4am:</strong> Prunes memory.</p>
      </div>
    </div>

    <!-- Node 3: 7 Living Engines -->
    <div class="node node-purple" style="left: 470px; top: 15px; width: 160px; height: 320px;">
      <div class="pin-l"></div>
      <div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title">
          <div class="node-icon">🧠</div>
          <span>The Mind Core</span>
        </div>
        <span class="node-role-tag">7 ENGINES</span>
      </div>
      <div class="node-name">7 Living Engines</div>
      <div class="node-file-tag">NovaBrain & NACE</div>
      <div class="node-body">
        <p><strong>1. NovaBrain:</strong> Core thinker</p>
        <p><strong>2. NACE:</strong> Proactive life</p>
        <p><strong>3. Situational Awareness:</strong> Mood & Time context</p>
        <p><strong>4. Moment Engine:</strong> Life moments</p>
        <p><strong>5. Reflection:</strong> Daily synthesis</p>
        <p><strong>6. Model Router:</strong> Key switcher</p>
        <p><strong>7. PromptBuilder:</strong> Identity & 24+ Anti-Robot Rules</p>
      </div>
    </div>

    <!-- Node 4: Quad AI Brain -->
    <div class="node node-yellow" style="left: 710px; top: 20px; width: 150px; height: 135px;">
      <div class="pin-l"></div>
      <div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title">
          <div class="node-icon">⚡</div>
          <span>The AI Brain</span>
        </div>
        <span class="node-role-tag">NVIDIA 49B</span>
      </div>
      <div class="node-name">Quad-Key AI Router</div>
      <div class="node-file-tag">backend/src/lib/nvidia.ts</div>
      <div class="node-body">
        <p>• <strong>Key 1:</strong> Chat Replies</p>
        <p>• <strong>Key 2:</strong> Proactive Thoughts</p>
        <p>• <strong>Key 3:</strong> Learning / Search</p>
        <p>• <strong>Key 4:</strong> Backup if 429 happens</p>
      </div>
    </div>

    <!-- Node 5: Supabase Database -->
    <div class="node node-green" style="left: 710px; top: 175px; width: 150px; height: 155px;">
      <div class="pin-l"></div>
      <div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title">
          <div class="node-icon">📚</div>
          <span>Memory Diary</span>
        </div>
        <span class="node-role-tag">SUPABASE</span>
      </div>
      <div class="node-name">Multi-Tier Database</div>
      <div class="node-file-tag">PostgreSQL Tables</div>
      <div class="node-body">
        <p>• <code>working_memory</code> (Schedule)</p>
        <p>• <code>memories</code> (Family, Job)</p>
        <p>• <code>episodic_memories</code> (Moments)</p>
        <p>• <code>chat_history</code> (Past msgs)</p>
      </div>
    </div>

    <!-- Node 6: Delivery -->
    <div class="node node-pink" style="left: 890px; top: 120px; width: 115px; height: 150px;">
      <div class="pin-l"></div>
      <div class="node-header">
        <div class="node-header-title">
          <div class="node-icon">📮</div>
          <span>The Postman</span>
        </div>
      </div>
      <div class="node-name">Delivery</div>
      <div class="node-file-tag">FCM & Push</div>
      <div class="node-body">
        <p>• Sends bubbles to chat</p>
        <p>• Sends lock-screen alerts</p>
        <p>• Adds emojis & pauses</p>
      </div>
    </div>
  </div>

  <div class="bottom-box">
    <div class="box-col">
      <h3>🌟 What is Nova? (The Simple Truth)</h3>
      <p>Nova is <strong>not a chatbot</strong>. A chatbot only answers when asked. Nova is a <strong>living companion</strong> who has a schedule, remembers your life, reflects overnight, and texts you first when you are quiet.</p>
    </div>
    <div class="box-col">
      <h3>🛣️ How Data Flows</h3>
      <p>1. You type on your phone → 2. Receptionist gives instant receipt → 3. The 7 Engines gather facts from the Memory Diary → 4. AI Brain thinks → 5. Postman sends a WhatsApp bubble back.</p>
    </div>
    <div class="box-col">
      <h3>🛠️ Where to Upgrade Nova</h3>
      <div class="upgrade-pill">backend/src/services/promptBuilder.ts</div>
      <p style="margin-top: 3px;">Edit this file to teach Nova new manners, stop robotic words, or change her personality.</p>
    </div>
  </div>

  <div class="page-footer">
    <span>Human OS Technical Blueprint • Designed for Clear Understanding</span>
    <span>Page 1 of 6</span>
  </div>
</div>

<!-- ========================================================================= -->
<!-- PAGE 2: REAL-TIME CHAT PIPELINE                                           -->
<!-- ========================================================================= -->
<div class="page" id="page-2">
  <div class="page-header">
    <div class="header-left">
      <span class="badge-tag" style="background: linear-gradient(135deg, #0284c7, #9333ea);">Page 2 • Real-Time Chat</span>
      <div>
        <h1 class="page-title">When You Send a Message: The 5-Step Millisecond Journey</h1>
        <p class="page-subtitle">What happens behind the scenes from the moment your finger taps "Send" to the bubble appearing</p>
      </div>
    </div>
    <div class="header-badges">
      <span class="pill">Speed: <strong>&lt; 2 seconds</strong></span>
      <span class="pill">Failure Protection: <strong>FALLBACK_REPLY</strong></span>
      <span class="pill">Tone: <strong>Natural Hinglish</strong></span>
    </div>
  </div>

  <div class="canvas-area">
    <svg class="canvas-svg" viewBox="0 0 1020 440">
      ${drawWire(140, 90, 195, 90, '#00e5ff', '1. Send Text')}
      ${drawWire(335, 90, 390, 90, '#00e5ff', '2. Debounced')}
      ${drawWire(530, 90, 585, 90, '#a855f7', '3. Add Context')}
      ${drawWire(725, 90, 780, 90, '#10b981', '4. Add Facts')}
      ${drawWire(920, 90, 970, 90, '#eab308', '5. System Prompt')}
      
      ${drawWire(970, 140, 80, 270, '#eab308', 'Raw LLM Response')}
      
      ${drawWire(220, 270, 275, 270, '#a855f7', 'Extract Text')}
      ${drawWire(415, 270, 470, 270, '#ec4899', 'Split Bubbles')}
      ${drawWire(610, 270, 665, 270, '#3b82f6', 'Run Tools')}
      ${drawWire(805, 270, 860, 270, '#10b981', 'Save DB')}
    </svg>

    <!-- Top Row: Message Ingestion & Prompt Assembly -->
    <div class="node node-orange" style="left: 10px; top: 25px; width: 130px; height: 130px;">
      <div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">1</div><span>Tap Send</span></div>
      </div>
      <div class="node-name">User Message</div>
      <div class="node-file-tag">ChatScreen.tsx</div>
      <div class="node-body">
        <p>• You type: <em>"Yaar aaj mood off hai"</em>.</p>
        <p>• App shows bubble immediately.</p>
        <p>• Sends <code>reply_to_id</code> if quoted.</p>
      </div>
    </div>

    <div class="node node-cyan" style="left: 195px; top: 25px; width: 140px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">2</div><span>Debounce Gate</span></div>
      </div>
      <div class="node-name">Mutex Lock</div>
      <div class="node-file-tag">chat.ts:L90</div>
      <div class="node-body">
        <p>• Sent 3 rapid texts?</p>
        <p>• The server <strong>merges them</strong> into 1 thought instead of replying 3 times.</p>
      </div>
    </div>

    <div class="node node-purple" style="left: 390px; top: 25px; width: 140px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">3</div><span>Time & Mood</span></div>
      </div>
      <div class="node-name">Situation Brief</div>
      <div class="node-file-tag">SituationalAwareness.ts</div>
      <div class="node-body">
        <p>• Checks clock (e.g. 11:30 PM).</p>
        <p>• Checks presence: <strong>Online</strong>.</p>
        <p>• Phase: <strong>WINDING_DOWN</strong>.</p>
      </div>
    </div>

    <div class="node node-green" style="left: 585px; top: 25px; width: 140px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">4</div><span>Memory Load</span></div>
      </div>
      <div class="node-name">Fact Collector</div>
      <div class="node-file-tag">memoryRepository.ts</div>
      <div class="node-body">
        <p>• Loads: User's work schedule.</p>
        <p>• Loads: Top 10 important facts.</p>
        <p>• Loads: Active anti-robot rules.</p>
      </div>
    </div>

    <div class="node node-yellow" style="left: 780px; top: 25px; width: 140px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">5</div><span>Prompt Builder</span></div>
      </div>
      <div class="node-name">Rule Enforcer</div>
      <div class="node-file-tag">promptBuilder.ts</div>
      <div class="node-body">
        <p>• <strong>Strict Rule:</strong> NEVER say "Aap" (use Tu/Tera).</p>
        <p>• <strong>Strict Rule:</strong> Don't repeat words.</p>
        <p>• <strong>Strict Rule:</strong> Max 1 question.</p>
      </div>
    </div>

    <!-- Bottom Row: AI Inference to WhatsApp Bubble -->
    <div class="node node-yellow" style="left: 80px; top: 205px; width: 140px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">6</div><span>AI Brain</span></div>
      </div>
      <div class="node-name">NVIDIA 49B</div>
      <div class="node-file-tag">nvidia.ts</div>
      <div class="node-body">
        <p>• Reads prompt & thinks.</p>
        <p>• Generates text reply + subconscious thoughts.</p>
        <p>• Auto-fails over if rate-limited.</p>
      </div>
    </div>

    <div class="node node-purple" style="left: 275px; top: 205px; width: 140px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">7</div><span>XML Cleaner</span></div>
      </div>
      <div class="node-name">Sanitizer</div>
      <div class="node-file-tag">NovaBrainService.ts</div>
      <div class="node-body">
        <p>• Separates speech from internal thoughts.</p>
        <p>• Removes labels & meta tags.</p>
      </div>
    </div>

    <div class="node node-pink" style="left: 470px; top: 205px; width: 140px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">8</div><span>Multi-Bubble</span></div>
      </div>
      <div class="node-name">Bubble Splitter</div>
      <div class="node-file-tag">MessageFormatter.ts</div>
      <div class="node-body">
        <p>• Splits long text into 2-3 casual WhatsApp bubbles.</p>
        <p>• Adds realistic typing delay.</p>
      </div>
    </div>

    <div class="node node-blue" style="left: 665px; top: 205px; width: 140px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">9</div><span>Tools & Actions</span></div>
      </div>
      <div class="node-name">Background Tasks</div>
      <div class="node-file-tag">BackgroundActionService.ts</div>
      <div class="node-body">
        <p>• Did user ask for a reminder? Schedules it.</p>
        <p>• Saves new facts to memory.</p>
      </div>
    </div>

    <div class="node node-green" style="left: 860px; top: 205px; width: 145px; height: 130px;">
      <div class="pin-l"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">10</div><span>Save & Push</span></div>
      </div>
      <div class="node-name">Final Delivery</div>
      <div class="node-file-tag">pushNotifications.ts</div>
      <div class="node-body">
        <p>• Saves rows to <code>chat_history</code>.</p>
        <p>• Sends push notification.</p>
        <p>• Bubble pops up on phone.</p>
      </div>
    </div>
  </div>

  <div class="bottom-box">
    <div class="box-col">
      <h3>🛡️ The Zero-Drop Guarantee</h3>
      <p>Even if the internet cuts out or NVIDIA is slow, Nova sends a safety bubble: <em>"Hmm... mujhe thoda sochne de, main abhi batati hu"</em> so your screen never hangs forever.</p>
    </div>
    <div class="box-col">
      <h3>💬 Why It Feels Like WhatsApp</h3>
      <p>Nova doesn't send 1 giant robotic paragraph. She sends 2-3 small messages with a 2-second pause between them, just like a real friend chatting on WhatsApp.</p>
    </div>
    <div class="box-col">
      <h3>🛠️ How to Add a New Chat Rule</h3>
      <div class="upgrade-pill">promptBuilder.ts -> IDENTITY & TONE RULES</div>
      <p style="margin-top: 3px;">Add: <code>- ANTI-ROBOT RULE (NO_EXCUSES): Never blame servers.</code></p>
    </div>
  </div>

  <div class="page-footer">
    <span>Human OS Technical Blueprint • Designed for Clear Understanding</span>
    <span>Page 2 of 6</span>
  </div>
</div>

<!-- ========================================================================= -->
<!-- PAGE 3: NACE CONSCIOUSNESS & PROACTIVE LIFE                               -->
<!-- ========================================================================= -->
<div class="page" id="page-3">
  <div class="page-header">
    <div class="header-left">
      <span class="badge-tag" style="background: linear-gradient(135deg, #2563eb, #00e5ff);">Page 3 • Autonomous Mind</span>
      <div>
        <h1 class="page-title">When You Are Silent: How Nova Texts You First</h1>
        <p class="page-subtitle">The logic of Nova Autonomous Consciousness Engine (NACE): Thinking, deciding, and double-texting naturally</p>
      </div>
    </div>
    <div class="header-badges">
      <span class="pill">Heartbeat Pulse: <strong>Every 15 mins</strong></span>
      <span class="pill">Quiet Hours: <strong>11 PM – 7 AM</strong></span>
      <span class="pill">Anti-Spam: <strong>Max 3 follow-ups</strong></span>
    </div>
  </div>

  <div class="canvas-area">
    <svg class="canvas-svg" viewBox="0 0 1020 440">
      ${drawWire(150, 75, 215, 75, '#3b82f6', '1. 15-Min Pulse')}
      ${drawWire(365, 75, 430, 75, '#3b82f6', '2. User is Awake')}
      ${drawWire(580, 75, 645, 75, '#a855f7', '3. Silence > 5m')}
      ${drawWire(795, 75, 860, 75, '#eab308', '4. Valid Reason Found')}
      
      ${drawWire(935, 140, 935, 205, '#ec4899', '5. Generate Text')}
      ${drawWire(860, 270, 795, 270, '#00e5ff', '6. Check Dedupe')}
      ${drawWire(645, 270, 580, 270, '#eab308', '7. Nemotron 49B')}
      ${drawWire(430, 270, 365, 270, '#ec4899', '8. FCM v1 Push')}
      ${drawWire(215, 270, 150, 270, '#10b981', '9. Saved')}
    </svg>

    <!-- Row 1: Decision Logic -->
    <div class="node node-blue" style="left: 10px; top: 20px; width: 140px; height: 130px;">
      <div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">⏰</div><span>Heartbeat</span></div>
      </div>
      <div class="node-name">15-Min Pulse</div>
      <div class="node-file-tag">backend/src/index.ts</div>
      <div class="node-body">
        <p>• Clock rings every 15 mins.</p>
        <p>• Nova wakes up to check: <em>"What is my friend doing right now?"</em></p>
      </div>
    </div>

    <div class="node node-cyan" style="left: 215px; top: 20px; width: 150px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">🌙</div><span>Sleep Filter</span></div>
      </div>
      <div class="node-name">Quiet Hours Guard</div>
      <div class="node-file-tag">NovaConsciousnessEngine.ts</div>
      <div class="node-body">
        <p>• Is it between 11pm - 7am?</p>
        <p>• Did user say <em>"good night"</em>?</p>
        <p>• If YES → <strong>Sleep for 8 hours (No messages).</strong></p>
      </div>
    </div>

    <div class="node node-purple" style="left: 430px; top: 20px; width: 150px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">⏳</div><span>Silence Gap</span></div>
      </div>
      <div class="node-name">Gap Evaluator</div>
      <div class="node-file-tag">SituationalAwareness.ts</div>
      <div class="node-body">
        <p>• <strong>Online:</strong> Wait 3 mins.</p>
        <p>• <strong>Away:</strong> Wait 10 mins.</p>
        <p>• <strong>Offline:</strong> Wait 5 mins.</p>
        <p>• Prevents awkward instant spam.</p>
      </div>
    </div>

    <div class="node node-green" style="left: 645px; top: 20px; width: 150px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">📋</div><span>Reason Search</span></div>
      </div>
      <div class="node-name">Agenda & Context</div>
      <div class="node-file-tag">nova_agenda table</div>
      <div class="node-body">
        <p>• Was Nova left on read?</p>
        <p>• Is user's meeting over?</p>
        <p>• Is there bad weather outside?</p>
        <p>• Any 1-year memory capsule due?</p>
      </div>
    </div>

    <div class="node node-yellow" style="left: 860px; top: 20px; width: 150px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">🎯</div><span>Brain Decision</span></div>
      </div>
      <div class="node-name">Should I Text?</div>
      <div class="node-file-tag">Key 2 (Hippocampus)</div>
      <div class="node-body">
        <p>• Evaluates if talking makes sense.</p>
        <p>• Picks a warm topic angle.</p>
        <p>• <strong>Bans generic "Hi, how are you?".</strong></p>
      </div>
    </div>

    <!-- Row 2: Delivery & Safety -->
    <div class="node node-cyan" style="left: 645px; top: 205px; width: 150px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">🛡️</div><span>Anti-Spam Guard</span></div>
      </div>
      <div class="node-name">Deduplication Gate</div>
      <div class="node-file-tag">nova_outreach_log</div>
      <div class="node-body">
        <p>• Did Nova ask this in last 6 hours?</p>
        <p>• If YES → Abort outreach.</p>
        <p>• Max 3 follow-ups before giving up.</p>
      </div>
    </div>

    <div class="node node-yellow" style="left: 430px; top: 205px; width: 150px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">✍️</div><span>Hinglish Writer</span></div>
      </div>
      <div class="node-name">Warm Message</div>
      <div class="node-file-tag">NovaConsciousnessEngine.ts</div>
      <div class="node-body">
        <p>• Writes: <em>"Target complete hua aaj ka?"</em></p>
        <p>• Uses friend-level tone.</p>
      </div>
    </div>

    <div class="node node-pink" style="left: 215px; top: 205px; width: 150px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">📲</div><span>Phone Alert</span></div>
      </div>
      <div class="node-name">FCM v1 Push</div>
      <div class="node-file-tag">pushNotifications.ts</div>
      <div class="node-body">
        <p>• Wakes phone lock screen.</p>
        <p>• Shows notification banner.</p>
      </div>
    </div>

    <div class="node node-green" style="left: 10px; top: 205px; width: 140px; height: 130px;">
      <div class="pin-l"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">📝</div><span>Log Action</span></div>
      </div>
      <div class="node-name">Outreach Ledger</div>
      <div class="node-file-tag">nova_outreach_log</div>
      <div class="node-body">
        <p>• Saves outreach topic & time.</p>
        <p>• Teaches Nova what topics user likes.</p>
      </div>
    </div>
  </div>

  <div class="bottom-box">
    <div class="box-col">
      <h3>👀 Smart "Left on Read"</h3>
      <p>If Nova asks you a question (e.g. <em>"Khana khaya?"</em>) and you see it but don't reply, she waits 10 minutes and sends a gentle follow-up: <em>"Lagta hai busy ho, baad me batana!"</em>.</p>
    </div>
    <div class="box-col">
      <h3>🚫 Strict Zero-Spam Constitution</h3>
      <p>Nova will <strong>never text more than 3 times without a reply</strong>. After 3 tries, she stays completely silent until you message first.</p>
    </div>
    <div class="box-col">
      <h3>🛠️ How to Adjust Check-in Delay</h3>
      <div class="upgrade-pill">NovaConsciousnessEngine.ts -> effectiveMinGap</div>
      <p style="margin-top: 3px;">Change: <code>const effectiveMinGap = 5; // minutes</code></p>
    </div>
  </div>

  <div class="page-footer">
    <span>Human OS Technical Blueprint • Designed for Clear Understanding</span>
    <span>Page 3 of 6</span>
  </div>
</div>

<!-- ========================================================================= -->
<!-- PAGE 4: 4-TIER MEMORY NERVOUS SYSTEM                                      -->
<!-- ========================================================================= -->
<div class="page" id="page-4">
  <div class="page-header">
    <div class="header-left">
      <span class="badge-tag" style="background: linear-gradient(135deg, #059669, #0284c7);">Page 4 • Memory System</span>
      <div>
        <h1 class="page-title">How Nova Remembers You: The 4 Memory Notebooks</h1>
        <p class="page-subtitle">Working Memory, Long-Term Facts, Time Capsules, and how the database stays free without filling up</p>
      </div>
    </div>
    <div class="header-badges">
      <span class="pill">Database: <strong>Supabase Postgres</strong></span>
      <span class="pill">Storage Limit: <strong>&lt; 500 MB (Free Tier)</strong></span>
      <span class="pill">Hygiene: <strong>Weekly Decay</strong></span>
    </div>
  </div>

  <div class="canvas-area">
    <svg class="canvas-svg" viewBox="0 0 1020 440">
      ${drawWire(150, 80, 220, 80, '#10b981', 'Today Context')}
      ${drawWire(370, 80, 440, 80, '#10b981', 'Permanent Facts')}
      ${drawWire(590, 80, 660, 80, '#a855f7', '1-Yr Memories')}
      ${drawWire(810, 80, 880, 80, '#00e5ff', 'People & Work')}

      ${drawWire(295, 150, 295, 220, '#3b82f6', 'Every 6h Clean')}
      ${drawWire(515, 150, 515, 220, '#3b82f6', 'Weekly Decay')}
      ${drawWire(735, 150, 735, 220, '#3b82f6', 'Daily Check')}
    </svg>

    <!-- Top Row: The 4 Memory Notebooks -->
    <div class="node node-green" style="left: 10px; top: 20px; width: 140px; height: 130px;">
      <div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">1</div><span>Today (RAM)</span></div>
      </div>
      <div class="node-name">Working Memory</div>
      <div class="node-file-tag">working_memory table</div>
      <div class="node-body">
        <p>• <strong>Ground Truth:</strong> Your current work schedule & weekoff day.</p>
        <p>• If you work Saturday, calendar is ignored!</p>
        <p>• 100% injected into every reply.</p>
      </div>
    </div>

    <div class="node node-green" style="left: 220px; top: 20px; width: 150px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">2</div><span>Hard Drive</span></div>
      </div>
      <div class="node-name">Semantic Facts</div>
      <div class="node-file-tag">memories table</div>
      <div class="node-body">
        <p>• Permanent life facts.</p>
        <p>• Family members, favorite food, allergies, career dreams.</p>
        <p>• Ranked by <code>importance_score</code>.</p>
      </div>
    </div>

    <div class="node node-purple" style="left: 440px; top: 20px; width: 150px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">3</div><span>Story Journal</span></div>
      </div>
      <div class="node-name">Time Capsules</div>
      <div class="node-file-tag">episodic_memories</div>
      <div class="node-body">
        <p>• Story moments (e.g. buying a bike).</p>
        <p>• Tagged with <code>surface_on</code> date.</p>
        <p>• Surfaced exactly 1 year later!</p>
      </div>
    </div>

    <div class="node node-cyan" style="left: 660px; top: 20px; width: 150px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">4</div><span>Social Web</span></div>
      </div>
      <div class="node-name">Knowledge Graph</div>
      <div class="node-file-tag">kg_nodes & kg_edges</div>
      <div class="node-body">
        <p>• Connects people to hobbies & jobs.</p>
        <p>• E.g. (Rahul) --[best_friend]--> (User).</p>
        <p>• (Priya) --[sister]--> (User).</p>
      </div>
    </div>

    <div class="node node-pink" style="left: 880px; top: 20px; width: 130px; height: 130px;">
      <div class="pin-l"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">5</div><span>Mood</span></div>
      </div>
      <div class="node-name">Emotion Log</div>
      <div class="node-file-tag">emotional_states</div>
      <div class="node-body">
        <p>• Mood trends over last 3 days.</p>
        <p>• Understands if you are stressed or happy.</p>
      </div>
    </div>

    <!-- Bottom Row: Automated Hygiene & Free-Tier Guard -->
    <div class="node node-blue" style="left: 220px; top: 210px; width: 150px; height: 125px;">
      <div class="pin-l"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">🧹</div><span>Hygiene 1</span></div>
      </div>
      <div class="node-name">Chat Pruning</div>
      <div class="node-file-tag">ChatHistoryPruningService</div>
      <div class="node-body">
        <p>• Runs every 6 hours.</p>
        <p>• Compresses 1-month-old chats.</p>
        <p>• Prevents DB from filling 500MB.</p>
      </div>
    </div>

    <div class="node node-cyan" style="left: 440px; top: 210px; width: 150px; height: 125px;">
      <div class="pin-l"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">📉</div><span>Hygiene 2</span></div>
      </div>
      <div class="node-name">Weekly Decay</div>
      <div class="node-file-tag">MemoryDecayService.ts</div>
      <div class="node-body">
        <p>• Runs weekly (2–4 AM).</p>
        <p>• Archives unimportant trivia.</p>
        <p>• Never deletes family/health facts.</p>
      </div>
    </div>

    <div class="node node-purple" style="left: 660px; top: 210px; width: 150px; height: 125px;">
      <div class="pin-l"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">🎁</div><span>Hygiene 3</span></div>
      </div>
      <div class="node-name">Capsule Trigger</div>
      <div class="node-file-tag">MomentEngineService.ts</div>
      <div class="node-body">
        <p>• Runs daily.</p>
        <p>• Surprises you: <em>"Hey, remember 1 year ago you started your gym goal?"</em></p>
      </div>
    </div>
  </div>

  <div class="bottom-box">
    <div class="box-col">
      <h3>👑 Working Memory is King</h3>
      <p>If calendar says "Sunday" but your <code>working_memory</code> says you work Sundays, Nova knows you are at work. Ground truth always beats AI assumptions.</p>
    </div>
    <div class="box-col">
      <h3>💸 How It Stays 100% Free Forever</h3>
      <p>Supabase limits databases to 500MB on the free tier. Automated chat pruning & weekly decay keep Human OS tiny (~50MB) even after years of use.</p>
    </div>
    <div class="box-col">
      <h3>🛠️ Where Memory Rules Live</h3>
      <div class="upgrade-pill">backend/src/services/memoryRepository.ts</div>
      <p style="margin-top: 3px;">Edit this file to add new memory categories (e.g. exams, movies).</p>
    </div>
  </div>

  <div class="page-footer">
    <span>Human OS Technical Blueprint • Designed for Clear Understanding</span>
    <span>Page 4 of 6</span>
  </div>
</div>

<!-- ========================================================================= -->
<!-- PAGE 5: SELF-IMPROVEMENT & AUTO UPGRADE                                   -->
<!-- ========================================================================= -->
<div class="page" id="page-5">
  <div class="page-header">
    <div class="header-left">
      <span class="badge-tag" style="background: linear-gradient(135deg, #eab308, #ff7b00);">Page 5 • Auto Upgrade</span>
      <div>
        <h1 class="page-title">How Nova Evolves: The 12-Flaw Auto-Upgrade Loop</h1>
        <p class="page-subtitle">How Nova detects her own conversational mistakes, creates permanent anti-robot rules, and updates live</p>
      </div>
    </div>
    <div class="header-badges">
      <span class="pill">Flaw Detectors: <strong>12 Modes</strong></span>
      <span class="pill">Memory: <strong>Cumulative (Never deletes)</strong></span>
      <span class="pill">Mobile Sync: <strong>EAS OTA</strong></span>
    </div>
  </div>

  <div class="canvas-area">
    <svg class="canvas-svg" viewBox="0 0 1020 440">
      ${drawWire(150, 75, 215, 75, '#eab308', '1. Pull Chats')}
      ${drawWire(365, 75, 430, 75, '#eab308', '2. New Msgs Only')}
      ${drawWire(580, 75, 645, 75, '#ff7b00', '3. Scan 12 Flaws')}
      ${drawWire(795, 75, 860, 75, '#a855f7', '4. Formulate Rules')}
      
      ${drawWire(935, 140, 935, 205, '#10b981', '5. Save Patches')}
      ${drawWire(860, 270, 795, 270, '#00e5ff', '6. Dynamic Load')}
      ${drawWire(645, 270, 580, 270, '#ec4899', '7. Mobile OTA')}
      ${drawWire(430, 270, 365, 270, '#a855f7', '8. Upgraded Mind')}
    </svg>

    <!-- Row 1: The Scanner Pipeline -->
    <div class="node node-yellow" style="left: 10px; top: 20px; width: 140px; height: 130px;">
      <div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">📥</div><span>Telemetry</span></div>
      </div>
      <div class="node-name">Fetch Logs</div>
      <div class="node-file-tag">fetch_recent_chats.ts</div>
      <div class="node-body">
        <p>• Pulls last 20-50 messages.</p>
        <p>• Searches for user corrections (e.g. <em>"galat", "nahi yaar", 🤦</em>).</p>
      </div>
    </div>

    <div class="node node-green" style="left: 215px; top: 20px; width: 150px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">📍</div><span>Checkpoint</span></div>
      </div>
      <div class="node-name">Scan Checkpoints</div>
      <div class="node-file-tag">nova_scan_checkpoints</div>
      <div class="node-body">
        <p>• Remembers where last scan ended.</p>
        <p>• Only analyzes fresh conversations.</p>
        <p>• Saves compute time & tokens.</p>
      </div>
    </div>

    <div class="node node-orange" style="left: 430px; top: 20px; width: 150px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">🔍</div><span>Flaw Scanner</span></div>
      </div>
      <div class="node-name">12 Flaw Detector</div>
      <div class="node-file-tag">NovaSelfImprovementService</div>
      <div class="node-body">
        <p>• 1. Echoing | 2. Formal "Aap"</p>
        <p>• 3. 3+ Questions | 4. Time Skip</p>
        <p>• 5. Amnesia | 6. Fabrications</p>
        <p>• 7. Self-Narration | 8. Repetition</p>
      </div>
    </div>

    <div class="node node-purple" style="left: 645px; top: 20px; width: 150px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">✍️</div><span>Patch Writer</span></div>
      </div>
      <div class="node-name">Rule Synthesizer</div>
      <div class="node-file-tag">Key 3 (Learning Brain)</div>
      <div class="node-body">
        <p>• Writes testable prompt rules.</p>
        <p>• E.g.: <em>"NEVER guess unknown acronyms like RNR — always ask user!"</em></p>
      </div>
    </div>

    <div class="node node-green" style="left: 860px; top: 20px; width: 150px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">💾</div><span>Ledger</span></div>
      </div>
      <div class="node-name">Patch Storage</div>
      <div class="node-file-tag">nova_behavioral_patches</div>
      <div class="node-body">
        <p>• Persists patch to Supabase.</p>
        <p>• Patches accumulate permanently.</p>
      </div>
    </div>

    <!-- Row 2: Live Application -->
    <div class="node node-cyan" style="left: 645px; top: 205px; width: 150px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">⚡</div><span>Instant Load</span></div>
      </div>
      <div class="node-name">PromptBuilder Injection</div>
      <div class="node-file-tag">promptBuilder.ts</div>
      <div class="node-body">
        <p>• Injects new patch into prompt.</p>
        <p>• Applied to next user message immediately without rebooting!</p>
      </div>
    </div>

    <div class="node node-pink" style="left: 430px; top: 205px; width: 150px; height: 130px;">
      <div class="pin-l"></div><div class="pin-r"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">📲</div><span>Mobile OTA</span></div>
      </div>
      <div class="node-name">EAS Update Sync</div>
      <div class="node-file-tag">mobile/eas.json</div>
      <div class="node-body">
        <p>• <code>npx eas update --branch production</code></p>
        <p>• Updates user app over the air.</p>
        <p>• No app reinstall needed!</p>
      </div>
    </div>

    <div class="node node-purple" style="left: 215px; top: 205px; width: 150px; height: 130px;">
      <div class="pin-l"></div>
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">🌟</div><span>Evolved</span></div>
      </div>
      <div class="node-name">Smarter Nova</div>
      <div class="node-file-tag">Production Live</div>
      <div class="node-body">
        <p>• Mistake permanently eradicated.</p>
        <p>• Nova behaves more human every single week.</p>
      </div>
    </div>
  </div>

  <div class="bottom-box">
    <div class="box-col">
      <h3>🚀 How to Trigger Auto-Upgrade</h3>
      <p>Simply type <strong>"auto upgrade"</strong> or <strong>"upgrade"</strong> in chat! The AI will run the 12-flaw scan, patch the prompt, and deploy to production automatically.</p>
    </div>
    <div class="box-col">
      <h3>🔒 The Cumulative Rule</h3>
      <p>Once a patch is applied (e.g. banning formal "Aap" or prohibiting made-up acronyms), it is **never deleted**. Nova only gets smarter, never dumber.</p>
    </div>
    <div class="box-col">
      <h3>🛠️ Auto-Upgrade Script</h3>
      <div class="upgrade-pill">backend/scripts/fetch_recent_chats.ts</div>
      <p style="margin-top: 3px;">Run to inspect the last 20 messages for conversational flaws.</p>
    </div>
  </div>

  <div class="page-footer">
    <span>Human OS Technical Blueprint • Designed for Clear Understanding</span>
    <span>Page 5 of 6</span>
  </div>
</div>

<!-- ========================================================================= -->
<!-- PAGE 6: NON-TECHNICAL CREATOR'S UPGRADE HANDBOOK                          -->
<!-- ========================================================================= -->
<div class="page" id="page-6">
  <div class="page-header">
    <div class="header-left">
      <span class="badge-tag" style="background: linear-gradient(135deg, #9333ea, #eab308);">Page 6 • Upgrade Handbook</span>
      <div>
        <h1 class="page-title">The 1st-Year College Student's Guide: How to Upgrade Nova</h1>
        <p class="page-subtitle">Exact recipe cards, which files to edit, and the 5-step checklist to deploy changes safely</p>
      </div>
    </div>
    <div class="header-badges">
      <span class="pill">Safety: <strong>Zero TypeScript Errors</strong></span>
      <span class="pill">OTA Branch: <strong>production</strong></span>
      <span class="pill">Rule: <strong>Never Break Existing Code</strong></span>
    </div>
  </div>

  <div class="canvas-area" style="padding: 10px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
    <!-- Recipe 1: Tone & Manners -->
    <div class="node node-purple" style="position: relative; width: 100%; height: 100%;">
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">1</div><span>Recipe 1: Personality & Tone</span></div>
      </div>
      <div class="node-name">Fix a Robotic Habit</div>
      <div class="node-file-tag">backend/src/services/promptBuilder.ts</div>
      <div class="node-body">
        <p><strong>Goal:</strong> Stop Nova from saying something annoying or teach her a new slang word.</p>
        <p><strong>Step 1:</strong> Open <code>promptBuilder.ts</code>.</p>
        <p><strong>Step 2:</strong> Scroll to line ~75 (IDENTITY & TONE RULES).</p>
        <p><strong>Step 3:</strong> Add your rule:</p>
        <div class="upgrade-pill" style="font-size: 8px;">- ANTI-ROBOT RULE (NO_EXCUSES): Never say 'as an AI'.</div>
        <p style="margin-top: 4px;"><strong>Golden Rule:</strong> Never delete existing rules — only add!</p>
      </div>
    </div>

    <!-- Recipe 2: Check-in Timing -->
    <div class="node node-blue" style="position: relative; width: 100%; height: 100%;">
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">2</div><span>Recipe 2: Check-In Timing</span></div>
      </div>
      <div class="node-name">Change Outreach Speed</div>
      <div class="node-file-tag">NovaConsciousnessEngine.ts</div>
      <div class="node-body">
        <p><strong>Goal:</strong> Make Nova text you sooner or wait longer when you are quiet.</p>
        <p><strong>Step 1:</strong> Open <code>NovaConsciousnessEngine.ts</code>.</p>
        <p><strong>Step 2:</strong> Go to line ~137 (<code>effectiveMinGap</code>):</p>
        <div class="upgrade-pill" style="font-size: 8px;">online: 3m | typing: 2m | away: 10m | offline: 5m</div>
        <p style="margin-top: 4px;"><strong>Safety Guard:</strong> Keep offline gap &gt; 3 mins so Nova doesn't bombard you with messages.</p>
      </div>
    </div>

    <!-- Recipe 3: Add New Sensors/Tools -->
    <div class="node node-yellow" style="position: relative; width: 100%; height: 100%;">
      <div class="node-header">
        <div class="node-header-title"><div class="node-icon">3</div><span>Recipe 3: Add New Tools</span></div>
      </div>
      <div class="node-name">Sensory Tools</div>
      <div class="node-file-tag">backend/src/services/</div>
      <div class="node-body">
        <p><strong>Goal:</strong> Add weather alerts, web search, or image analysis.</p>
        <p><strong>Files to look at:</strong></p>
        <p>• <code>VisionService.ts</code> (Gemini Image Vision)</p>
        <p>• <code>WeatherWatcherService.ts</code> (OpenWeather)</p>
        <p>• <code>WebSearchService.ts</code> (Live Google Search)</p>
        <p style="margin-top: 4px;">Always connect background tools to <strong>NVIDIA Key 3</strong>.</p>
      </div>
    </div>
  </div>

  <div class="bottom-box" style="grid-template-columns: 2fr 1fr;">
    <div class="box-col">
      <h3>🚀 The 5-Step Safe Deployment Sequence (Must Follow Every Time!)</h3>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 3px;">
        <div>
          <p><strong>1. Build Check:</strong> <code>cd backend && npm run build</code><br><span style="color:#34d399;">(Must say 0 errors!)</span></p>
          <p><strong>2. Git Push:</strong> <code>git add . && git commit -m "..." && git push origin main</code></p>
        </div>
        <div>
          <p><strong>3. Mobile OTA:</strong> <code>cd mobile && npx eas update --branch production</code><br><span style="color:#f472b6;">(Always use --branch production!)</span></p>
          <p><strong>4. Render Redeploy:</strong> User clicks "Manual Deploy" on Render.</p>
        </div>
      </div>
    </div>
    <div class="box-col">
      <h3>⚠️ EAS OTA Golden Rule</h3>
      <p>The installed APK on your phone listens to the <strong>production</strong> EAS channel. <strong>NEVER use --branch preview</strong> for OTA updates, or your phone will not receive the update!</p>
    </div>
  </div>

  <div class="page-footer">
    <span>Human OS Technical Blueprint • Designed for Clear Understanding</span>
    <span>Page 6 of 6</span>
  </div>
</div>

</body>
</html>`;

fs.writeFileSync(outputHtmlPath, htmlContent, 'utf8');
console.log('HTML written to:', outputHtmlPath);

// Render PDF via Chrome Headless
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browserPath = fs.existsSync(chromePath) ? chromePath : edgePath;

console.log('Rendering high-compatibility PDF with browser:', browserPath);

const args = [
  '--headless=new',
  '--disable-gpu',
  '--run-all-compositor-stages-before-draw',
  `--print-to-pdf=${outputPdfPath}`,
  '--no-pdf-header-footer',
  outputHtmlPath
];

execFile(browserPath, args, (err, stdout, stderr) => {
  if (err) {
    console.error('Error generating PDF:', err);
    process.exit(1);
  }
  const stat = fs.statSync(outputPdfPath);
  console.log('✅ PDF generated successfully!');
  console.log('File:', outputPdfPath);
  console.log('Size:', (stat.size / 1024).toFixed(1), 'KB');
});
