const { TurnAnalyzer } = require('./dist/services/TurnAnalyzer.js');
console.log("No, that is wrong. Make that yellow.");
console.log(JSON.stringify(TurnAnalyzer.analyze([{ role: 'user', message: 'No, that is wrong. Make that yellow.' }]), null, 2));
console.log("-------------------");
console.log("My brother's name is actually Amit");
console.log(JSON.stringify(TurnAnalyzer.analyze([{ role: 'user', message: "My brother's name is actually Amit" }]), null, 2));
console.log("-------------------");
console.log("No, that is incorrect. (with assistant context)");
console.log(JSON.stringify(TurnAnalyzer.analyze([
  { role: 'assistant', message: 'I remember your favorite color is green.' },
  { role: 'user', message: 'No, that is incorrect.' }
]), null, 2));
