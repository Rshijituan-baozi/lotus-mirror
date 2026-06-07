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
        prices: { subTotal: { value: 39.9 }, grandTotal: { value: 39.9 } },
      },
    },
  },
};

patchProductPayload(addToCart, 'https://www.lotusscom.my');
const item = addToCart.data.addProductsToCart.cart.cartItems[0];
const product = item.product;
const serialized = JSON.stringify(addToCart);

assert(!serialized.includes('media_gallery'), 'cart product must not get media_gallery override');
assert(!serialized.includes('29 Pieces'), 'cart product must not get long description override');
assert(item.itemSubtotal?.value === 59.9, 'itemSubtotal should be 59.9');
assert(product.priceRange.minimumPrice.finalPrice.value === 59.9, 'unit price should be 59.9');
assert(product.image.url.includes('/product-overrides/'), 'cart thumbnail should be overridden');

const listing = {
  data: {
    products: {
      items: [{ sku: '74718282', quantity: 1, product: { sku: '74718282' } }],
    },
  },
};
patchProductPayload(listing, 'https://www.lotusscom.my');
assert(listing.data.products.items[0].name || listing.data.products.items[0].product?.name, 'listing patch ok');

console.log('test:patch OK');
