import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getProductOverrides } from '../src/product-overrides.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const template = fs.readFileSync(path.join(__dirname, '../src/inject.js'), 'utf8');
const overrides = JSON.stringify(getProductOverrides()).replace(/<\//g, '\\u003c/');
const script = template
  .replace(/<\/script/gi, '<\\/script')
  .replace('/*__PRODUCT_OVERRIDES__*/{}', overrides);

const tmp = path.join(__dirname, '../.tmp-inject-check.js');
fs.writeFileSync(tmp, script);
console.log('Wrote', tmp, 'bytes', script.length);
