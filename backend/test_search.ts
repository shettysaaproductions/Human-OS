import { webSearchService } from './src/services/WebSearchService';

async function test() {
  console.log("Skipping LLM evaluation due to API limits, directly executing search for: 'Who won the 2024 F1 race in Monaco?'");
  const query = "2024 Monaco Grand Prix winner";
  console.log("LLM decided to search for:", query);

  if (query) {
    console.log("\nExecuting live search...");
    const results = await webSearchService.executeSearch(query);
    console.log("\n--- INJECTED CONTEXT FOR NOVA ---");
    console.log(results);
    console.log("---------------------------------");
  } else {
    console.log("No search needed.");
  }
}

test().catch(console.error);
