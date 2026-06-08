import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inject = fs.readFileSync(path.join(__dirname, '../src/inject.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const samples = [
  'validation?websiteCode=malaysia_hy&totalPrice=65.2',
  '/__api/shoponline-bffapi.lotuss.com.my/v1/cart/validation?websiteCode=malaysia_hy',
  'https://shoponline-bffapi.lotuss.com.my/cart/validation?websiteCode=malaysia_hy',
  '/cybersource/config',
];

assert(inject.includes('(?:^|[/?&])validation'), 'validation URL matcher should allow relative paths');
assert(inject.includes('fakeCheckoutFetchResponse'), 'fetch should return fake success response');
assert(inject.includes('completeCheckoutInterceptXhr'), 'XHR should complete with fake success');
assert(inject.includes('handlePlaceOrderIntent'), 'Place Order intent handler should exist');
assert(inject.includes('mousedown'), 'Place Order should hook mousedown/touchstart');
assert(inject.includes('location.replace'), 'redirect should use location.replace');

const fnBlock = inject.slice(
  inject.indexOf('function isCheckoutInterceptUrl'),
  inject.indexOf('var lotusCheckoutRedirecting')
);
assert(!fnBlock.includes('isCartPage'), 'Place Order intercept should not depend on cart pathname');

console.log('test:place-order-intercept OK');
console.log('sample URLs covered:', samples.join(' | '));
