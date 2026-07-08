const MarkdownIt = require('markdown-it');
const md = new MarkdownIt();

console.log(md.render('1. **Cooing and Babbling:**'));
console.log(md.render('2. **Responds To Sounds**:'));
console.log(md.render('**1. Cooing and Babbling:**'));
console.log(md.render('1. **Right to Gather\nInformation**:'));
