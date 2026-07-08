const MarkdownIt = require('markdown-it');
const md = new MarkdownIt();

const text = `| Characteristics | India | United States |
| --- | --- | --- |
| **Government Type** | Parliamentary Democracy | Constitutional Federal Republic |
| \\*\\*Presidential System\\*\\* | No | Yes |`;

const tokens = md.parse(text, {});
console.log(JSON.stringify(tokens, null, 2));
