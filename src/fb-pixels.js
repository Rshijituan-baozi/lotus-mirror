import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PIXELS_PATH = path.join(__dirname, '..', 'data', 'fb-pixels.json');

let cachedPixels = null;
let cachedMtime = 0;

function readPixelsFile() {
  try {
    const stat = fs.statSync(PIXELS_PATH);
    if (cachedPixels && stat.mtimeMs === cachedMtime) return cachedPixels;
    const raw = fs.readFileSync(PIXELS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    cachedPixels = Array.isArray(parsed) ? parsed : [];
    cachedMtime = stat.mtimeMs;
    return cachedPixels;
  } catch {
    cachedPixels = [];
    cachedMtime = 0;
    return cachedPixels;
  }
}

export function getFbPixels() {
  return readPixelsFile();
}

export function saveFbPixels(pixels) {
  const list = Array.isArray(pixels) ? pixels : [];
  fs.writeFileSync(PIXELS_PATH, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  cachedPixels = list;
  cachedMtime = fs.statSync(PIXELS_PATH).mtimeMs;
}

export function getPublicSettings() {
  const fbPixels = getFbPixels()
    .filter((entry) => entry && entry.enabled !== false && entry.pixelId)
    .map((entry) => ({
      enabled: true,
      pixelId: String(entry.pixelId).trim(),
      label: entry.label != null ? String(entry.label) : '',
    }));
  return { fbPixels };
}
