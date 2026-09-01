import { TurnAnalyzer } from '../src/services/TurnAnalyzer';

async function run() {
  console.log("=== TURN ANALYZER VERIFICATION ===");
  
  const msg1 = "Remember this: my favourite dessert is rasmalai.";
  const res1 = TurnAnalyzer.analyze([{ message: msg1 }]);
  console.log("\nMSG 1:", msg1);
  console.log("hasExplicitRemember:", res1.hasExplicitRemember);
  console.log("hasCorrections:", res1.hasCorrections);
  console.log("correctionTarget:", res1.correctionTarget);

  const msg2 = "Actually, correct that — my favourite dessert is gulab jamun.";
  // We need to provide the turn context so it resolves antecedent
  const context = {
    memories: [{ key: 'favourite_dessert', value: 'rasmalai' }],
    recentMessages: ["Remember this: my favourite dessert is rasmalai."]
  };
  const res2 = TurnAnalyzer.analyze([{ message: msg2 }], context);
  
  console.log("\nMSG 2:", msg2);
  console.log("hasExplicitRemember:", res2.hasExplicitRemember);
  console.log("hasCorrections:", res2.hasCorrections);
  console.log("correctionTarget:", res2.correctionTarget);
  console.log("units:", res2.units.filter(u => u.type === 'correction'));

  console.log("\nMSG 3: Ambiguous correction");
  const msg3 = "No wait actually change that, I like something else instead.";
  const res3 = TurnAnalyzer.analyze([{ message: msg3 }], context);
  console.log("hasCorrections:", res3.hasCorrections);
  console.log("correctionTarget:", res3.correctionTarget);

}

run().catch(console.error);
