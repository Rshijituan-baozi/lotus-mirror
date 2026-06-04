import 'dotenv/config';
import express from 'express';
import http from 'http';
import https from 'https';
import { createLotusProxy } from './proxy.js';

const PORT = parseInt(process.env.PORT || '3000');
const app = express();

// GraphQL proxy (needed by CIF commerce initialization)
const magentoAgent = new https.Agent({ keepAlive: false });
app.options('/graphql', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Store');
  res.sendStatus(200);
});
app.use('/graphql', (req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const qs = (req.url.indexOf('?') >= 0) ? req.url.slice(req.url.indexOf('?')) : '';
    const r = https.request({
      hostname: 'mcprod.lotuss.com.my', port: 443, path: '/graphql' + qs,
      method: req.method, agent: magentoAgent,
      headers: {
        'Host': 'mcprod.lotuss.com.my',
        'Content-Type': req.headers['content-type'] || 'application/json',
        'Store': req.headers['store'] || 'default',
      }
    }, pRes => {
      const h = { ...pRes.headers };
      h['access-control-allow-origin'] = '*';
      delete h['www-authenticate'];
      res.writeHead(pRes.statusCode, h);
      pRes.pipe(res);
    });
    r.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end(); } });
    if (body) r.write(body);
    r.end();
  });
});

app.use('/', createLotusProxy());

const server = http.createServer(app);
server.timeout = 0;
server.listen(PORT, '0.0.0.0', () => console.log(`[Lotus] http://localhost:${PORT}`));
