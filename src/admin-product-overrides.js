import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getProductOverrides,
  saveProductOverrides,
} from './product-overrides.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'lotus-admin';
const PUBLIC_OVERRIDES = path.join(__dirname, '..', 'public', 'product-overrides');
const ADMIN_HTML = path.join(__dirname, '..', 'public', 'admin', 'product-overrides', 'index.html');

function authAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_TOKEN) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

export function createAdminProductOverridesRouter() {
  const router = express.Router();
  router.use(express.json({ limit: '25mb' }));

  router.get('/admin/product-overrides', (req, res) => {
    res.sendFile(ADMIN_HTML);
  });

  router.get('/admin/api/product-overrides', authAdmin, (req, res) => {
    res.json(getProductOverrides());
  });

  router.put('/admin/api/product-overrides/:sku', authAdmin, (req, res) => {
    const sku = String(req.params.sku || '').trim();
    if (!sku) {
      res.status(400).json({ error: 'sku required' });
      return;
    }
    const all = getProductOverrides();
    all[sku] = {
      ...req.body,
      sku,
      enabled: req.body.enabled !== false,
    };
    saveProductOverrides(all);
    res.json({ ok: true, item: all[sku] });
  });

  router.delete('/admin/api/product-overrides/:sku', authAdmin, (req, res) => {
    const sku = String(req.params.sku || '').trim();
    const all = getProductOverrides();
    delete all[sku];
    saveProductOverrides(all);
    res.json({ ok: true });
  });

  router.post('/admin/api/product-overrides/:sku/images', authAdmin, (req, res) => {
    const sku = String(req.params.sku || '').trim();
    const filename = String(req.body.filename || '').replace(/[^a-zA-Z0-9._-]/g, '');
    const dataBase64 = String(req.body.dataBase64 || '');
    if (!sku || !filename || !dataBase64) {
      res.status(400).json({ error: 'sku, filename and dataBase64 required' });
      return;
    }
    const dir = path.join(PUBLIC_OVERRIDES, sku);
    fs.mkdirSync(dir, { recursive: true });
    const buf = Buffer.from(dataBase64, 'base64');
    fs.writeFileSync(path.join(dir, filename), buf);
    res.json({ url: `/product-overrides/${sku}/${filename}` });
  });

  return router;
}
