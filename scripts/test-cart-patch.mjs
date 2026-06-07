import { patchProductPayload } from '../src/product-overrides.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const addToCart = {
  data: {
    addProductsToCart: {
      cart: {
        cartItems: [{
          quantity: 1,
          product: {
            sku: '74718282',
            name: 'Original',
            image: { url: 'https://cdn.example.com/img.jpg', __typename: 'ProductImage' },
            priceRange: {
              minimumPrice: {
                finalPrice: { value: 39.9, currency: 'MYR' },
                __typename: 'ProductPrice',
              },
              __typename: 'PriceRange',
            },
            __typename: 'SimpleProduct',
          },
          __typename: 'SimpleCartItem',
        }],
        prices: { subTotal: { value: 39.9, text: 'RM39.90' }, grandTotal: { value: 39.9, text: 'RM39.90' } },
      },
    },
  },
};

patchProductPayload(addToCart, 'https://www.lotusscom.my');
const cart = addToCart.data.addProductsToCart.cart;
assert(cart.prices.subTotal.value === 59.9, 'cart.prices.subTotal should be 59.9');
assert(cart.prices.subTotal.text === 'RM59.90', 'cart.prices.subTotal.text should be RM59.90');

const getCart = {
  data: {
    items: [{
      itemId: '1',
      quantity: 1,
      itemSubtotal: { value: 39.9, currency: 'MYR' },
      product: { sku: '74718282', finalPricePerUOW: 39.9 },
    }],
    prices: { subTotal: { value: 39.9, text: 'RM39.90' }, grandTotal: { value: 39.9 } },
    itemsCount: 1,
  },
};

patchProductPayload(getCart, 'https://www.lotusscom.my');
assert(getCart.data.prices.subTotal.value === 59.9, 'getCart items[] should sync prices.subTotal');
assert(getCart.data.items[0].itemSubtotal.value === 59.9, 'getCart line item should be patched');

const summary = {
  data: {
    subTotal: { value: 39.9, text: 'RM39.90' },
    grandTotal: { value: 39.9, text: 'RM39.90' },
    itemsCount: 1,
  },
};

patchProductPayload(summary, 'https://www.lotusscom.my');
assert(summary.data.subTotal.value === 59.9, 'summary subTotal should be 59.9');
assert(summary.data.subTotal.text === 'RM59.90', 'summary subTotal.text should be RM59.90');
assert(summary.data.grandTotal.value === 59.9, 'summary grandTotal should be 59.9');

const listing = {
  data: {
    products: {
      items: [{ sku: '74718282', quantity: 1, product: { sku: '74718282' } }],
    },
  },
};
patchProductPayload(listing, 'https://www.lotusscom.my');
assert(!listing.data.products.items[0].itemSubtotal, 'product listing items must not be treated as cart lines');

console.log('test:patch OK');
