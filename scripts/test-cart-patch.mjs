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

const checkoutCart = {
  data: {
    items: [{
      itemId: '1',
      quantity: 2,
      priceSale: 39.5,
      itemSubtotal: { value: 79, currency: 'MYR' },
      product: { sku: '74718282' },
    }],
    additionalData: { totalLoyaltyPoint: 79 },
    loyaltyPoints: 79,
    itemsCount: 1,
  },
};

patchProductPayload(checkoutCart, 'https://www.lotusscom.my');
assert(checkoutCart.data.additionalData.totalLoyaltyPoint === 119.8, 'checkout loyalty should be 119.8 for qty 2');
assert(checkoutCart.data.loyaltyPoints === 119.8, 'checkout loyaltyPoints root should be 119.8');

const savingsCart = {
  data: {
    items: [{
      itemId: '1',
      quantity: 2,
      priceSale: 39.9,
      priceBase: 59.9,
      itemSubtotal: { value: 79.8, currency: 'MYR' },
      product: { sku: '74718282' },
    }],
    prices: {
      subTotal: { value: 79.8, text: 'RM79.80' },
      subTotalBeforeDiscount: { value: 119.8, text: 'RM119.80' },
      totalSavings: { value: 40, text: 'RM40.00' },
    },
    pricingSummary: {
      totalPrice: 119.8,
      totalDiscountedPrice: 79.8,
      totalSaved: 40,
    },
  },
};

patchProductPayload(savingsCart, 'https://www.lotusscom.my');
assert(savingsCart.data.prices.subTotal.value === 119.8, 'patched subtotal should be 119.8');
assert(savingsCart.data.prices.totalSavings.value === 280, 'savings should be 280 for qty 2');
assert(savingsCart.data.prices.subTotalBeforeDiscount.value === 399.8, 'before discount should be 399.8');
assert(savingsCart.data.pricingSummary.totalSaved === 280, 'pricingSummary totalSaved should be 280');

const checkoutBffShape = {
  data: {
    getCartSummary: {
      items: [{
        itemId: '1',
        quantity: 2,
        priceSale: 39.9,
        priceBase: 59.9,
        itemSubtotal: { value: 79.8 },
        product: { sku: '74718282' },
      }],
      totalSavings: { value: 40, currency: 'MYR', currencyPrefix: 'RM' },
      subTotalBeforeDiscount: { value: 119.8, currency: 'MYR', currencyPrefix: 'RM' },
      prices: { subTotal: { value: 79.8, text: 'RM79.80' } },
      pricingSummary: { totalPrice: 119.8, totalDiscountedPrice: 79.8, totalSaved: 40 },
    },
  },
};

patchProductPayload(checkoutBffShape, 'https://www.lotusscom.my');
const checkoutNode = checkoutBffShape.data.getCartSummary;
assert(checkoutNode.totalSavings.value === 280, 'checkout root totalSavings should be 280');
assert(checkoutNode.totalSavings.currencyPrefix === 'RM', 'currencyPrefix should be preserved');
assert(checkoutNode.pricingSummary.totalSaved === 280, 'checkout pricingSummary.totalSaved should be 280');

const mixedCart = {
  data: {
    items: [
      {
        itemId: '1',
        quantity: 2,
        priceSale: 39.9,
        priceBase: 59.9,
        itemSubtotal: { value: 79.8 },
        product: { sku: '74718282' },
      },
      {
        itemId: '2',
        quantity: 1,
        priceSale: 10,
        priceBase: 15,
        itemSubtotal: { value: 10 },
        product: { sku: 'OTHER999' },
      },
    ],
    prices: { subTotal: { value: 89.8 }, totalSavings: { value: 50 } },
  },
};

patchProductPayload(mixedCart, 'https://www.lotusscom.my');
assert(mixedCart.data.prices.subTotal.value === 129.8, 'mixed cart subtotal should be 129.8');
assert(mixedCart.data.prices.totalSavings.value === 285, 'mixed cart savings should be 285');

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
