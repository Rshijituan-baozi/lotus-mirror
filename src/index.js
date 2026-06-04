import 'dotenv/config';
import express from 'express';
import http from 'http';
import { createLotusProxy, handleGraphql, handleApiPassthrough } from './proxy.js';

process.on('uncaughtException', (err) => { console.error('[FATAL]', err.message); });
process.on('unhandledRejection', (r) => { console.error('[REJECT]', r); });

const PORT = parseInt(process.env.PORT || '3000');
const app = express();

app.options('/graphql', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Store');
  res.sendStatus(200);
});
app.use('/graphql', handleGraphql);

app.options('/__api/*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(204);
});
app.use('/__api', handleApiPassthrough);

app.use('/', createLotusProxy());

const server = http.createServer(app);
server.listen(PORT, '0.0.0.0', () => console.log(`[Lotus] http://localhost:${PORT}`));
