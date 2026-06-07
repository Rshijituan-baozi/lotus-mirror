import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OVERRIDES_PATH = path.join(__dirname, '..', 'data', 'product-overrides.json');

let cachedOverrides = null;
let cachedMtime = 0;

function readOverridesFile() {
  try {
    const stat = fs.statSync(OVERRIDES_PATH);
    if (cachedOverrides && stat.mtimeMs === cachedMtime) return cachedOverrides;
    const raw = fs.readFileSync(OVERRIDES_PATH, 'utf8');
    cachedOverrides = JSON.parse(raw);
    cachedMtime = stat.mtimeMs;
    return cachedOverrides;
  } catch {
    cachedOverrides = {};
    cachedMtime = 0;
    return cachedOverrides;
  }
}

export function getProductOverrides() {
  return readOverridesFile();
}

export function saveProductOverrides(data) {
  fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
  cachedOverrides = data;
  cachedMtime = fs.statSync(OVERRIDES_PATH).mtimeMs;
}

export function getEnabledOverrideMap() {
  const all = readOverridesFile();
  const map = new Map();
  for (const entry of Object.values(all)) {
    if (!entry || entry.enabled === false || !entry.sku) continue;
    map.set(String(entry.sku), entry);
  }
  return map;
}

function absImageUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (/^https?:\/\//i.test(url)) return url;
  return url.startsWith('/') ? url : `/${url}`;
}

function setHtmlField(obj, key, html) {
  if (!html) return;
  if (obj[key] && typeof obj[key] === 'object') {
    obj[key].html = html;
    return;
  }
  obj[key] = { html };
}

function ensureImageField(obj, key, url) {
  if (!url) return;
  if (obj[key] && typeof obj[key] === 'object') {
    obj[key].url = url;
    if (!obj[key].__typename) obj[key].__typename = 'ProductImage';
    return;
  }
  obj[key] = { __typename: 'ProductImage', url };
}

function patchTabsDescription(obj, html) {
  if (!html) return;
  if (Array.isArray(obj.tabs)) {
    let found = false;
    obj.tabs = obj.tabs.map(tab => {
      if (tab && tab.title === 'Product Information') {
        found = true;
        return { ...tab, content: html };
      }
      return tab;
    });
    if (!found) {
      obj.tabs.unshift({ title: 'Product Information', content: html });
    }
  }
}

function buildGalleryItem(existing, imageUrl, override, index) {
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  base.__typename = base.__typename || 'ProductImage';
  base.url = imageUrl;
  base.label = base.label ?? override.name ?? `Image ${index + 1}`;
  base.position = index;
  base.disabled = base.disabled ?? false;
  base.image = base.image && typeof base.image === 'object'
    ? { ...base.image, url: imageUrl }
    : { url: imageUrl };
  return base;
}

function patchPriceOnObject(obj, price) {
  if (!obj || typeof obj !== 'object' || price == null) return;
  const value = Number(price);
  if (!Number.isFinite(value)) return;

  if (obj.price_range?.minimum_price) {
    const mp = obj.price_range.minimum_price;
    if (mp.final_price) mp.final_price.value = value;
    else mp.final_price = { value, currency: 'MYR' };
  }
  if (obj.priceRange?.minimumPrice) {
    const mp = obj.priceRange.minimumPrice;
    if (mp.finalPrice) mp.finalPrice.value = value;
    else mp.finalPrice = { value, currency: 'MYR' };
  }
  if (obj.price && typeof obj.price === 'object' && 'value' in obj.price) {
    obj.price.value = value;
  }
  if (obj.prices?.price && typeof obj.prices.price === 'object') {
    obj.prices.price.value = value;
  }
  if (obj.prices?.row_total_including_tax) {
    obj.prices.row_total_including_tax.value = value;
  }
  if (obj.prices?.row_total) {
    obj.prices.row_total.value = value;
  }
}

function ensureMoney(obj, key, value, currency = 'MYR') {
  if (!Number.isFinite(value)) return;
  if (obj[key] && typeof obj[key] === 'object') {
    obj[key].value = value;
    if (!obj[key].currency) obj[key].currency = currency;
    return;
  }
  obj[key] = { value, currency };
}

function setMoneyObject(obj, key, value, currency = 'MYR') {
  if (!obj || typeof obj !== 'object' || !Number.isFinite(value)) return;
  const text = formatMoneyText(currency, value);
  if (obj[key] && typeof obj[key] === 'object') {
    obj[key].value = value;
    if (!obj[key].currency) obj[key].currency = currency;
    if (text) obj[key].text = text;
    return;
  }
  obj[key] = text ? { value, currency, text } : { value, currency };
}

function formatMoneyText(currency, value) {
  if (!Number.isFinite(value)) return null;
  const cur = currency || 'MYR';
  const prefix = cur === 'MYR' ? 'RM' : `${cur} `;
  return `${prefix}${value.toFixed(2)}`;
}

function applyCartMoneyTotals(bag, subtotal, delta, extras = {}) {
  if (!bag || typeof bag !== 'object') return;
  const { savings } = extras;

  setMoneyObject(bag, 'subTotal', subtotal);
  setMoneyObject(bag, 'sub_total', subtotal);
  // Item Subtotal in checkout UI reads subTotalBeforeDiscount / pricingSummary.totalPrice.
  setMoneyObject(bag, 'subTotalBeforeDiscount', subtotal);
  setMoneyObject(bag, 'sub_total_before_discount', subtotal);
  if (Number.isFinite(savings)) {
    setMoneyObject(bag, 'totalSavings', savings);
    setMoneyObject(bag, 'totalSaved', savings);
    setMoneyObject(bag, 'total_savings', savings);
  }
  if (typeof bag.totalItemPrice === 'number') bag.totalItemPrice = subtotal;
  setMoneyObject(bag, 'totalItemPrice', subtotal);

  if (Math.abs(delta) > 0.001) {
    for (const key of ['grandTotal', 'grand_total']) {
      if (bag[key] && Number.isFinite(Number(bag[key].value))) {
        const newGrand = Math.round((Number(bag[key].value) + delta) * 100) / 100;
        setMoneyObject(bag, key, newGrand);
      }
    }
    return;
  }

  for (const key of ['grandTotal', 'grand_total']) {
    const gVal = Number(bag[key]?.value);
    if (Number.isFinite(gVal) && Math.abs(gVal - (subtotal - delta)) < 0.02) {
      setMoneyObject(bag, key, subtotal);
    }
  }
}

function getLineTotals(item, overrideMap) {
  const productSku = item.product?.sku != null ? String(item.product.sku) : '';
  const itemSku = item.sku != null ? String(item.sku) : '';
  const sku = productSku || itemSku;
  const qty = Number(item.quantity ?? item.qty ?? 1);
  const override = sku && overrideMap.has(sku) ? overrideMap.get(sku) : null;

  let lineFinal = NaN;
  let lineRegular = NaN;

  if (override && Number.isFinite(Number(override.price))) {
    lineFinal = Math.round(Number(override.price) * qty * 100) / 100;
    if (Number.isFinite(Number(override.regularPrice))) {
      lineRegular = Math.round(Number(override.regularPrice) * qty * 100) / 100;
    }
  }

  if (!Number.isFinite(lineFinal)) {
    const sub = Number(item.itemSubtotal?.value ?? item.item_subtotal?.value ?? item.itemSubtotal);
    if (Number.isFinite(sub)) lineFinal = sub;
    else {
      const priceSale = Number(item.priceSale ?? item.product?.finalPricePerUOW ?? item.product?.final_price_per_uow);
      if (Number.isFinite(priceSale)) lineFinal = Math.round(priceSale * qty * 100) / 100;
    }
  }

  if (!Number.isFinite(lineRegular)) {
    const origLine = Number(
      item.originalItemSubtotal?.value
      ?? item.originalItemSubtotal
      ?? item.original_item_subtotal?.value
      ?? item.original_item_subtotal,
    );
    if (Number.isFinite(origLine)) {
      lineRegular = origLine;
    } else {
      const priceBase = Number(
        item.priceBase
        ?? item.product?.regularPricePerUOW
        ?? item.product?.regular_price_per_uow
        ?? item.product?.priceRange?.minimumPrice?.regularPrice?.value,
      );
      if (Number.isFinite(priceBase)) {
        lineRegular = Math.round(priceBase * qty * 100) / 100;
      } else {
        lineRegular = lineFinal;
      }
    }
  }

  return { lineFinal, lineRegular };
}

function sumCartRegularAndFinalTotals(items, overrideMap) {
  let regularTotal = 0;
  let finalTotal = 0;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const { lineFinal, lineRegular } = getLineTotals(item, overrideMap);
    if (Number.isFinite(lineRegular)) regularTotal += lineRegular;
    if (Number.isFinite(lineFinal)) finalTotal += lineFinal;
  }

  regularTotal = Math.round(regularTotal * 100) / 100;
  finalTotal = Math.round(finalTotal * 100) / 100;
  const savings = Math.max(0, Math.round((regularTotal - finalTotal) * 100) / 100);
  return { regularTotal, finalTotal, savings };
}

function patchPricingSummaryFields(node, regularTotal, finalTotal, savings) {
  if (!node || typeof node !== 'object') return;
  for (const key of ['pricingSummary', 'pricing_summary']) {
    const ps = node[key];
    if (!ps || typeof ps !== 'object') continue;
    if (Number.isFinite(finalTotal)) {
      ps.totalPrice = finalTotal;
      ps.total_price = finalTotal;
      ps.totalDiscountedPrice = finalTotal;
      ps.total_discounted_price = finalTotal;
    }
    if (Number.isFinite(savings)) {
      ps.totalSaved = savings;
      ps.total_saved = savings;
    }
    void regularTotal;
  }
}

function hasCartMoneyFields(node) {
  if (!node || typeof node !== 'object') return false;
  return node.subTotal != null || node.sub_total != null
    || node.grandTotal != null || node.grand_total != null
    || node.subTotalBeforeDiscount != null || node.sub_total_before_discount != null
    || node.totalSavings != null || node.totalSaved != null || node.total_savings != null
    || node.totalItemPrice != null;
}

function getCartTotalTargets(node) {
  if (!node || typeof node !== 'object') return [];
  const targets = [];
  if (node.prices && typeof node.prices === 'object') targets.push(node.prices);
  if (node.cart?.prices && typeof node.cart.prices === 'object') targets.push(node.cart.prices);
  if (hasCartMoneyFields(node)) targets.push(node);
  if (node.cart && (node.cart.subTotal != null || node.cart.grandTotal != null || node.cart.prices || hasCartMoneyFields(node.cart))) {
    if (!targets.includes(node.cart)) targets.push(node.cart);
  }
  return targets;
}

function getLoyaltyPerUnit(override) {
  if (override.loyaltyPoints != null) return Number(override.loyaltyPoints);
  if (override.price != null) return Number(override.price);
  return NaN;
}

function setCartLoyaltyTotals(node, total) {
  if (!node || typeof node !== 'object' || !Number.isFinite(total)) return;
  node.loyaltyPoints = total;
  if (node.loyalty && typeof node.loyalty === 'object') {
    node.loyalty.loyaltyPoints = total;
  }
  for (const key of ['additionalData', 'additional_data']) {
    if (node[key] && typeof node[key] === 'object') {
      node[key].totalLoyaltyPoint = total;
      node[key].total_loyalty_point = total;
    }
  }
}

function sumCartLoyaltyFromItems(items, overrideMap) {
  let total = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const productSku = item.product?.sku != null ? String(item.product.sku) : '';
    const itemSku = item.sku != null ? String(item.sku) : '';
    const sku = productSku || itemSku;
    const qty = Number(item.quantity ?? item.qty ?? 1);
    const override = sku && overrideMap.has(sku) ? overrideMap.get(sku) : null;

    if (override) {
      const perUnit = getLoyaltyPerUnit(override);
      if (Number.isFinite(perUnit)) {
        total += Math.round(perUnit * (Number.isFinite(qty) ? qty : 1) * 100) / 100;
        continue;
      }
    }

    const lineSubtotal = Number(item.itemSubtotal?.value ?? item.item_subtotal?.value ?? item.itemSubtotal);
    if (Number.isFinite(lineSubtotal)) {
      total += lineSubtotal;
      continue;
    }

    const priceSale = Number(item.priceSale ?? item.product?.finalPricePerUOW ?? item.product?.loyaltyPoints);
    if (Number.isFinite(priceSale)) {
      total += Math.round(priceSale * (Number.isFinite(qty) ? qty : 1) * 100) / 100;
    }
  }
  return Math.round(total * 100) / 100;
}

function patchStandaloneCartLoyalty(node, overrideMap) {
  const loyaltyVal = Number(
    node.additionalData?.totalLoyaltyPoint
    ?? node.additional_data?.total_loyalty_point
    ?? node.loyaltyPoints
    ?? node.loyalty?.loyaltyPoints,
  );
  if (!Number.isFinite(loyaltyVal)) return false;

  const itemCount = Number(node.itemsCount ?? node.itemCount ?? 1);
  for (const entry of overrideMap.values()) {
    const upstream = entry.upstreamPrice != null ? Number(entry.upstreamPrice) : null;
    const loyalty = getLoyaltyPerUnit(entry);
    if (!Number.isFinite(upstream) || !Number.isFinite(loyalty)) continue;
    for (let q = 1; q <= Math.max(itemCount, 1); q++) {
      if (Math.abs(loyaltyVal - upstream * q) < 0.55) {
        const newTotal = Math.round(loyalty * q * 100) / 100;
        setCartLoyaltyTotals(node, newTotal);
        return true;
      }
    }
  }
  return false;
}

function patchCartItemPricing(cartItem, override) {
  const finalPrice = override.price != null ? Number(override.price) : null;
  if (!Number.isFinite(finalPrice)) return;
  const qty = Number(cartItem.quantity ?? cartItem.qty ?? 1);
  const lineTotal = Math.round(finalPrice * (Number.isFinite(qty) ? qty : 1) * 100) / 100;
  const loyaltyPerUnit = getLoyaltyPerUnit(override);

  setMoneyObject(cartItem, 'itemSubtotal', lineTotal);
  setMoneyObject(cartItem, 'item_subtotal', lineTotal);

  cartItem.finalPricePerUOW = finalPrice;
  cartItem.final_price_per_uow = finalPrice;
  cartItem.priceSale = finalPrice;
  if (override.regularPrice != null) {
    cartItem.priceBase = Number(override.regularPrice);
  }

  if (Number.isFinite(loyaltyPerUnit)) {
    cartItem.loyaltyPoints = Math.round(loyaltyPerUnit * (Number.isFinite(qty) ? qty : 1) * 100) / 100;
  }

  if (cartItem.product && typeof cartItem.product === 'object') {
    cartItem.product.finalPricePerUOW = finalPrice;
    cartItem.product.final_price_per_uow = finalPrice;
    if (override.regularPrice != null) {
      const regular = Number(override.regularPrice);
      cartItem.product.regularPricePerUOW = regular;
      cartItem.product.regular_price_per_uow = regular;
    }
    if (Number.isFinite(loyaltyPerUnit)) {
      cartItem.product.loyaltyPoints = loyaltyPerUnit;
      cartItem.product.loyalty_points = loyaltyPerUnit;
    }
  }

  if (cartItem.prices && typeof cartItem.prices === 'object') {
    setMoneyObject(cartItem.prices, 'price', finalPrice);
    setMoneyObject(cartItem.prices, 'row_total', lineTotal);
    setMoneyObject(cartItem.prices, 'row_total_including_tax', lineTotal);
    setMoneyObject(cartItem.prices, 'rowTotal', lineTotal);
  }
}

function getCartItemsList(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node.cartItems)) return node.cartItems;
  if (Array.isArray(node.cart_items)) return node.cart_items;
  if (node.cart && Array.isArray(node.cart.cartItems)) return node.cart.cartItems;
  if (node.cart && Array.isArray(node.cart.cart_items)) return node.cart.cart_items;
  if (Array.isArray(node.items) && node.items.length && node.items.some(isCartLineItem)) return node.items;
  return null;
}

function isCartLineItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.itemSubtotal != null || item.item_subtotal != null) return true;
  if (item.itemId != null || item.item_id != null) return true;
  if (item.cartItemId != null || item.cart_item_id != null) return true;
  const typename = item.__typename != null ? String(item.__typename) : '';
  if (/cartitem/i.test(typename)) return true;
  return false;
}

function patchCartContainerTotals(node, overrideMap) {
  const items = getCartItemsList(node);
  if (!items?.length) return;

  let patchedAny = false;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const productSku = item.product?.sku != null ? String(item.product.sku) : '';
    const itemSku = item.sku != null ? String(item.sku) : '';
    const sku = productSku || itemSku;
    if (sku && overrideMap.has(sku)) {
      patchCartItemPricing(item, overrideMap.get(sku));
      patchedAny = true;
    }
  }

  if (!patchedAny) return;

  const totals = sumCartRegularAndFinalTotals(items, overrideMap);
  const subtotal = totals.finalTotal;
  const oldSubtotal = Number(
    node.prices?.subTotal?.value
    ?? node.prices?.sub_total?.value
    ?? node.subTotal?.value
    ?? node.sub_total?.value
    ?? node.cart?.prices?.subTotal?.value
    ?? subtotal,
  );
  const delta = subtotal - oldSubtotal;
  const extras = { regularTotal: totals.regularTotal, savings: totals.savings };

  for (const target of getCartTotalTargets(node)) {
    applyCartMoneyTotals(target, subtotal, delta, extras);
  }

  patchPricingSummaryFields(node, totals.regularTotal, totals.finalTotal, totals.savings);
  setCartLoyaltyTotals(node, sumCartLoyaltyFromItems(items, overrideMap));
}

function isCartSummaryNode(node) {
  if (!node || typeof node !== 'object') return false;
  if (getCartItemsList(node)) return false;
  return (node.subTotal != null || node.sub_total != null)
    && (node.grandTotal != null || node.grand_total != null || node.itemsCount != null || node.itemCount != null);
}

function patchStandaloneCartSummary(node, overrideMap) {
  if (!isCartSummaryNode(node)) return false;
  const subVal = Number(node.subTotal?.value ?? node.sub_total?.value);
  if (!Number.isFinite(subVal)) return false;

  const itemCount = Number(node.itemsCount ?? node.itemCount ?? 1);
  let newSub = subVal;
  let changed = false;

  for (const entry of overrideMap.values()) {
    const upstream = entry.upstreamPrice != null ? Number(entry.upstreamPrice) : null;
    const override = entry.price != null ? Number(entry.price) : null;
    if (!Number.isFinite(upstream) || !Number.isFinite(override)) continue;
    const delta = override - upstream;
    for (let q = 1; q <= Math.max(itemCount, 1); q++) {
      if (Math.abs(subVal - upstream * q) < 0.02) {
        newSub = Math.round((subVal + delta * q) * 100) / 100;
        changed = true;
        break;
      }
    }
    if (changed) break;
  }

  if (!changed) return false;
  const delta = newSub - subVal;
  const totals = sumCartRegularAndFinalTotals(
    getCartItemsList(node) || [],
    overrideMap,
  );
  const extras = totals.regularTotal > newSub
    ? { regularTotal: totals.regularTotal, savings: totals.savings }
    : {
      regularTotal: Number(node.subTotalBeforeDiscount?.value ?? node.sub_total_before_discount?.value ?? newSub),
      savings: Math.max(0, Math.round(((Number(node.subTotalBeforeDiscount?.value ?? newSub) - newSub) * 100)) / 100),
    };

  for (const target of getCartTotalTargets(node)) {
    applyCartMoneyTotals(target, newSub, delta, extras);
  }
  patchPricingSummaryFields(node, extras.regularTotal, newSub, extras.savings);
  patchStandaloneCartLoyalty(node, overrideMap);
  return true;
}

function isDiscountBadgePromotion(p) {
  if (!p || typeof p !== 'object') return false;
  if (String(p.ruleType || '').toLowerCase() === 'discount') return true;
  const img = String(p.image || p.imageUrl || '').toLowerCase();
  return img.includes('discount-bage') || /discount[\s%20]+\d/.test(img);
}

function patchPromotionsDiscountBadges(obj) {
  if (!Array.isArray(obj.promotions)) return;
  obj.promotions = obj.promotions.filter(p => !isDiscountBadgePromotion(p));
}

function patchMinimumPriceBlock(mp, finalPrice, regularPrice, discountPercent) {
  if (!mp || typeof mp !== 'object') return;
  ensureMoney(mp, 'final_price', finalPrice);
  ensureMoney(mp, 'finalPrice', finalPrice);
  ensureMoney(mp, 'regular_price', regularPrice);
  ensureMoney(mp, 'regularPrice', regularPrice);
  if (!Number.isFinite(discountPercent)) return;
  if (!mp.discount || typeof mp.discount !== 'object') mp.discount = {};
  mp.discount.percent_off = discountPercent;
  mp.discount.percentOff = discountPercent;
  mp.discount.display_number = discountPercent;
  mp.discount.displayNumber = discountPercent;
}

function patchPricingFields(obj, override) {
  const finalPrice = override.price != null ? Number(override.price) : null;
  const regularPrice = override.regularPrice != null ? Number(override.regularPrice) : null;
  const discountPercent = override.discountPercent != null ? Number(override.discountPercent) : null;
  const loyaltyPoints = override.loyaltyPoints != null
    ? Number(override.loyaltyPoints)
    : finalPrice;

  if (!Number.isFinite(finalPrice)) return;

  if (obj.price_range?.minimum_price) {
    patchMinimumPriceBlock(obj.price_range.minimum_price, finalPrice, regularPrice, discountPercent);
  } else if (obj.price_range && typeof obj.price_range === 'object') {
    obj.price_range.minimum_price = {};
    patchMinimumPriceBlock(obj.price_range.minimum_price, finalPrice, regularPrice, discountPercent);
  }

  if (obj.priceRange?.minimumPrice) {
    patchMinimumPriceBlock(obj.priceRange.minimumPrice, finalPrice, regularPrice, discountPercent);
  } else if (obj.priceRange && typeof obj.priceRange === 'object') {
    obj.priceRange.minimumPrice = {};
    patchMinimumPriceBlock(obj.priceRange.minimumPrice, finalPrice, regularPrice, discountPercent);
  } else if (!obj.price_range) {
    obj.priceRange = { minimumPrice: {} };
    patchMinimumPriceBlock(obj.priceRange.minimumPrice, finalPrice, regularPrice, discountPercent);
  }

  if (Number.isFinite(loyaltyPoints)) {
    obj.loyalty_points = loyaltyPoints;
    obj.loyaltyPoints = loyaltyPoints;
  }

  if (Number.isFinite(discountPercent)) {
    patchPromotionsDiscountBadges(obj);
  }
}

function patchBrandField(obj, brand) {
  if (!brand) return;
  if (!obj.links || typeof obj.links !== 'object') obj.links = {};
  if (!obj.links.brand || typeof obj.links.brand !== 'object') obj.links.brand = {};
  obj.links.brand.name = brand;
}

function applyProductOverride(obj, override, origin) {
  if (!obj || !override) return;

  if (override.name) {
    obj.name = override.name;
    if (obj.product_name) obj.product_name = override.name;
  }

  patchBrandField(obj, override.brand);

  if (override.price != null || override.regularPrice != null || override.discountPercent != null) {
    patchPricingFields(obj, override);
  }

  if (override.shortDescriptionHtml) {
    if (obj.shortDescription && typeof obj.shortDescription === 'object') {
      setHtmlField(obj, 'shortDescription', override.shortDescriptionHtml);
    } else {
      obj.shortDescription = override.shortDescriptionHtml;
    }
    if (obj.short_description && typeof obj.short_description === 'object') {
      setHtmlField(obj, 'short_description', override.shortDescriptionHtml);
    } else if (obj.short_description == null) {
      setHtmlField(obj, 'short_description', override.shortDescriptionHtml);
    }
  }
  if (override.descriptionHtml) {
    patchTabsDescription(obj, override.descriptionHtml);
    if (obj.description && typeof obj.description === 'object') {
      setHtmlField(obj, 'description', override.descriptionHtml);
    } else {
      obj.description = override.descriptionHtml;
    }
  }

  if (Array.isArray(override.images) && override.images.length) {
    const primary = absImageUrl(override.images[0]);
    const existingGallery = Array.isArray(obj.media_gallery) ? obj.media_gallery : [];
    const existingBffGallery = Array.isArray(obj.mediaGallery) ? obj.mediaGallery : [];
    const gallery = override.images.map((url, index) => buildGalleryItem(
      existingGallery[index] || existingBffGallery[index],
      absImageUrl(url),
      override,
      index,
    ));

    ensureImageField(obj, 'image', primary);
    ensureImageField(obj, 'thumbnail', primary);
    ensureImageField(obj, 'small_image', primary);
    obj.media_gallery = gallery;
    obj.mediaGallery = gallery.map(item => ({
      ...item,
      image: item.image && typeof item.image === 'object'
        ? { ...item.image, url: item.image.url || item.url }
        : { url: item.url },
    }));
  }

  if (override.price != null && override.regularPrice == null && override.discountPercent == null) {
    patchPriceOnObject(obj, override.price);
  }
}

function applyCartProductOverride(obj, override) {
  if (!obj || !override) return;

  if (override.name) {
    obj.name = override.name;
    if (obj.product_name) obj.product_name = override.name;
  }

  patchBrandField(obj, override.brand);

  const finalPrice = override.price != null ? Number(override.price) : null;
  const regularPrice = override.regularPrice != null ? Number(override.regularPrice) : null;
  if (Number.isFinite(finalPrice)) {
    obj.finalPricePerUOW = finalPrice;
    obj.final_price_per_uow = finalPrice;
    if (Number.isFinite(regularPrice)) {
      obj.regularPricePerUOW = regularPrice;
      obj.regular_price_per_uow = regularPrice;
    }
    patchPriceOnObject(obj, finalPrice);
    if (obj.priceRange?.minimumPrice || obj.price_range?.minimum_price) {
      patchPricingFields(obj, override);
    }
    const loyaltyPerUnit = getLoyaltyPerUnit(override);
    if (Number.isFinite(loyaltyPerUnit)) {
      obj.loyaltyPoints = loyaltyPerUnit;
      obj.loyalty_points = loyaltyPerUnit;
    }
  }

  if (Array.isArray(override.images) && override.images.length) {
    const primary = absImageUrl(override.images[0]);
    ensureImageField(obj, 'image', primary);
    ensureImageField(obj, 'thumbnail', primary);
  }
}

function walkAndPatch(node, overrideMap, origin, seen = new WeakSet(), parent = null) {
  if (!node || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    node.forEach(item => walkAndPatch(item, overrideMap, origin, seen, parent));
    return;
  }

  const inCartProduct = parent != null && isCartLineItem(parent) && parent.product === node;
  const sku = node.sku != null ? String(node.sku) : '';
  const urlKey = node.urlKey != null ? String(node.urlKey) : (node.url_key != null ? String(node.url_key) : '');
  if (sku && overrideMap.has(sku)) {
    if (inCartProduct) {
      applyCartProductOverride(node, overrideMap.get(sku));
    } else {
      applyProductOverride(node, overrideMap.get(sku), origin);
    }
  } else if (urlKey && !inCartProduct) {
    for (const entry of overrideMap.values()) {
      if (entry.urlKey && String(entry.urlKey) === urlKey) {
        applyProductOverride(node, entry, origin);
        break;
      }
    }
  }

  if (node.product && typeof node.product === 'object' && isCartLineItem(node)) {
    const productSku = node.product.sku != null ? String(node.product.sku) : '';
    if (productSku && overrideMap.has(productSku)) {
      const override = overrideMap.get(productSku);
      applyCartProductOverride(node.product, override);
      patchCartItemPricing(node, override);
      if (override.name) {
        node.product_name = override.name;
      }
    }
  }

  patchCartContainerTotals(node, overrideMap);
  patchStandaloneCartSummary(node, overrideMap);
  patchStandaloneCartLoyalty(node, overrideMap);

  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') walkAndPatch(value, overrideMap, origin, seen, node);
  }
}

export function patchProductPayload(data, origin) {
  if (!data || typeof data !== 'object') return data;
  const overrideMap = getEnabledOverrideMap();
  if (!overrideMap.size) return data;
  try {
    walkAndPatch(data, overrideMap, origin);
  } catch {
    return data;
  }
  return data;
}

export function patchJsonText(text, origin) {
  if (!text) return text;
  try {
    const data = JSON.parse(text);
    patchProductPayload(data, origin);
    return JSON.stringify(data);
  } catch {
    return text;
  }
}

export function getOverridesFilePath() {
  return OVERRIDES_PATH;
}
