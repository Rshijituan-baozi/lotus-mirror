import 'dotenv/config';
import express from 'express';
import http from 'http';
import { createLotusProxy, handleApiPassthrough, handleGraphql } from './proxy.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const app = express();

app.disable('x-powered-by');

app.options('/graphql', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
  res.sendStatus(204);
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
server.requestTimeout = 120000;
server.headersTimeout = 125000;
server.keepAliveTimeout = 65000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Lotus mirror] listening on http://0.0.0.0:${PORT}`);
});
