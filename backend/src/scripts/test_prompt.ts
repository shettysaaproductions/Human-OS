import { promptBuilder } from '../services/promptBuilder';

const res = promptBuilder.buildSystemPrompt(
  "BASE",
  [],
  [],
  undefined,
  undefined,
  [],
  'hi'
);

console.log("PROMPT OUTPUT:");
console.log(res);
