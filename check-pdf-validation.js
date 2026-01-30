import fs from 'fs';

const file = process.argv[2];
const buffer = fs.readFileSync(file);

console.log('File size:', buffer.length);
console.log('First 8 bytes:', buffer.subarray(0, 8));
console.log('As string:', buffer.subarray(0, 8).toString());
console.log('Expected: %PDF-1.');

// Check magic number
const magic = buffer.subarray(0, 5).toString();
console.log('Magic number check:', magic === '%PDF-');
