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

function walkAndPatch(node, overrideMap, origin, seen = new WeakSet()) {
  if (!node || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    node.forEach(item => walkAndPatch(item, overrideMap, origin, seen));
    return;
  }

  const sku = node.sku != null ? String(node.sku) : '';
  const urlKey = node.urlKey != null ? String(node.urlKey) : (node.url_key != null ? String(node.url_key) : '');
  if (sku && overrideMap.has(sku)) {
    applyProductOverride(node, overrideMap.get(sku), origin);
  } else if (urlKey) {
    for (const entry of overrideMap.values()) {
      if (entry.urlKey && String(entry.urlKey) === urlKey) {
        applyProductOverride(node, entry, origin);
        break;
      }
    }
  }

  if (node.product && typeof node.product === 'object') {
    const productSku = node.product.sku != null ? String(node.product.sku) : '';
    if (productSku && overrideMap.has(productSku)) {
      applyProductOverride(node.product, overrideMap.get(productSku), origin);
      if (overrideMap.get(productSku).name) {
        node.product_name = overrideMap.get(productSku).name;
      }
    }
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') walkAndPatch(value, overrideMap, origin, seen);
  }
}

export function patchProductPayload(data, origin) {
  if (!data || typeof data !== 'object') return data;
  const overrideMap = getEnabledOverrideMap();
  if (!overrideMap.size) return data;
  walkAndPatch(data, overrideMap, origin);
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
