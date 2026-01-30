import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const pdfParse = require('pdf-parse');

console.log('typeof pdfParse:', typeof pdfParse);
console.log('pdfParse keys:', Object.keys(pdfParse));
console.log('pdfParse:', pdfParse);
console.log('pdfParse.default:', pdfParse.default);

// Try calling it
const fs = require('fs');
const buffer = fs.readFileSync('./test.pdf'); // Use any PDF file

if (typeof pdfParse === 'function') {
  console.log('\n✅ pdfParse is directly a function');
  pdfParse(buffer).then(data => {
    console.log('Pages:', data.numpages);
  });
} else if (typeof pdfParse.default === 'function') {
  console.log('\n✅ pdfParse.default is a function');
  pdfParse.default(buffer).then(data => {
    console.log('Pages:', data.numpages);
  });
}
