const fs = require('fs');
const file = 'c:/Users/Mentorus2/OneDrive/Documents/Human Os/backend/src/routes/chat.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  "      const responseConfig = classifyIntent(effectiveMessage, recentMessages.map(m => m.content));\n\n        profile,",
  "      const responseConfig = classifyIntent(effectiveMessage, recentMessages.map(m => m.content));\n\n      const brainContext = {\n        memories,\n        workingMemories,\n        profile,"
);

fs.writeFileSync(file, content);
console.log('Fixed brainContext removal');
