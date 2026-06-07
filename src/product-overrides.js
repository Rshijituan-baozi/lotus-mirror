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

function absImageUrl(url, origin) {
  if (!url || typeof url !== 'string') return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (origin) return origin.replace(/\/$/, '') + (url.startsWith('/') ? url : `/${url}`);
  return url;
}

function setHtmlField(obj, key, html) {
  if (!html) return;
  if (obj[key] && typeof obj[key] === 'object') {
    obj[key].html = html;
    return;
  }
  obj[key] = { html };
}

function setImageUrl(field, url) {
  if (!url) return;
  if (field && typeof field === 'object') {
    field.url = url;
    return;
  }
}

function patchPriceOnObject(obj, price) {
  if (!obj || typeof obj !== 'object' || price == null) return;
  const value = Number(price);
  if (!Number.isFinite(value)) return;

  if (obj.price_range?.minimum_price) {
    const mp = obj.price_range.minimum_price;
    if (mp.final_price) mp.final_price.value = value;
    if (mp.regular_price) mp.regular_price.value = value;
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

function applyProductOverride(obj, override, origin) {
  if (!obj || !override) return;

  if (override.name) {
    obj.name = override.name;
    if (obj.product_name) obj.product_name = override.name;
  }

  if (override.shortDescriptionHtml) {
    setHtmlField(obj, 'short_description', override.shortDescriptionHtml);
  }
  if (override.descriptionHtml) {
    setHtmlField(obj, 'description', override.descriptionHtml);
  }

  if (Array.isArray(override.images) && override.images.length) {
    const primary = absImageUrl(override.images[0], origin);
    const gallery = override.images.map((url, index) => ({
      url: absImageUrl(url, origin),
      label: override.name || `Image ${index + 1}`,
      position: index,
      disabled: false,
    }));

    setImageUrl(obj.image, primary);
    setImageUrl(obj.thumbnail, primary);
    setImageUrl(obj.small_image, primary);
    obj.media_gallery = gallery;
  }

  if (override.price != null) {
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
  if (sku && overrideMap.has(sku)) {
    applyProductOverride(node, overrideMap.get(sku), origin);
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
