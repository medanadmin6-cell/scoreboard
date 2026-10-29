// One request handler for both `node server.js` (local) and the Vercel function (api/index.js).
const https = require('https');
const fs = require('fs');
const path = require('path');
const { createCustom } = require('./custom');

const ROOT_DIR = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');

loadEnv(path.join(ROOT_DIR, '.env'));

const AF_KEY = (process.env.API_FOOTBALL_KEY || '').trim().replace(/^['"]|['"]$/g, '');
const AF_HOST = 'v3.football.api-sports.io';
const AF_ENDPOINTS = new Set(['fixtures', 'fixtures/headtohead', 'standings', 'leagues']);
const ESPN_HOST = 'site.api.espn.com';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

function loadEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

// ---------- database ----------
function pickStore() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
    const { createPgStore } = require('./store-pg');
    return createPgStore((text, params) => pool.query(text, params));
  }
  if (process.env.VERCEL) return null;
  const { createSqliteStore } = require('./store-sqlite');
  return createSqliteStore(DATA_DIR);
}
const store = pickStore();
const custom = store ? createCustom(store, { legacyJson: store.kind === 'sqlite' ? path.join(DATA_DIR, 'custom.json') : null }) : null;
const dbName = store ? store.kind : 'none';

// ---------- upstream fetch with cache ----------
const cache = new Map();
const inflight = new Map();

function httpsJson(host, reqPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get({ host, path: reqPath, headers, timeout: 30000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error('upstream ' + res.statusCode));
        try {
          const j = JSON.parse(body);
          const errs = j.errors && (Array.isArray(j.errors) ? j.errors.length : Object.keys(j.errors).length);
          if (errs) return reject(new Error('upstream error: ' + JSON.stringify(j.errors)));
          resolve(body);
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('upstream timeout')));
    req.on('error', reject);
  });
}

async function cached(res, key, ttl, fetcher, label) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return sendRaw(res, 200, hit.body);
  try {
    if (!inflight.has(key)) inflight.set(key, fetcher().finally(() => inflight.delete(key)));
    const body = await inflight.get(key);
    cache.set(key, { t: Date.now(), body });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    sendRaw(res, 200, body);
  } catch (e) {
    if (hit) return sendRaw(res, 200, hit.body);
    console.error(`[${label}]`, key, e.message);
    send(res, 502, { error: 'sports data unavailable', detail: String(e.message).slice(0, 300) });
  }
}

function afTtl(endpoint, params) {
  if (endpoint === 'fixtures') {
    if (params.has('live')) return 15e3;
    if (params.has('id')) return 20e3;
    const date = params.get('date');
    if (date) {
      const diff = Math.abs(new Date(date) - new Date(new Date().toISOString().slice(0, 10))) / 864e5;
      return diff <= 1 ? 30e3 : 15 * 60e3;
    }
    return 5 * 60e3;
  }
  if (endpoint === 'standings') return 10 * 60e3;
  if (endpoint === 'fixtures/headtohead') return 60 * 60e3;
  return 6 * 60 * 60e3;
}

function handleAf(res, sub, query) {
  if (!AF_KEY) return send(res, 503, { error: 'API_FOOTBALL_KEY is not set' });
  if (!AF_ENDPOINTS.has(sub)) return send(res, 404, { error: 'unknown endpoint' });
  const params = new URLSearchParams(query);
  for (const [k, v] of params) {
    if (!/^[a-z0-9_]+$/i.test(k) || !/^[\w\-/.:+]*$/.test(v)) return send(res, 400, { error: 'bad parameter' });
  }
  const key = sub + '?' + params.toString();
  return cached(res, key, afTtl(sub, params), () => httpsJson(AF_HOST, '/' + key, { 'x-apisports-key': AF_KEY }), 'api-football');
}

function handleEspn(res, sub, query) {
  const m = sub.match(/^(site|v2)\/([\w\-./]+)$/);
  if (!m || sub.includes('..')) return send(res, 404, { error: 'unknown endpoint' });
  if (query && !/^[\w\-=&.%:,]*$/.test(query)) return send(res, 400, { error: 'bad parameter' });
  const upstream = (m[1] === 'site' ? '/apis/site/v2/sports/' : '/apis/v2/sports/') + m[2] + (query ? '?' + query : '');
  const ttl = /standings/.test(m[2]) ? 10 * 60e3 : /summary/.test(m[2]) ? 15e3 : 30e3;
  return cached(res, 'espn:' + upstream, ttl, () => httpsJson(ESPN_HOST, upstream), 'espn');
}

// ---------- responses ----------
function send(res, code, obj) { sendRaw(res, code, JSON.stringify(obj)); }
function sendRaw(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(res, urlPath) {
  let file = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  if (urlPath.endsWith('/')) file = path.join(file, 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) {
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        res.writeHead(e2 ? 404 : 200, { 'Content-Type': TYPES['.html'] });
        res.end(e2 ? 'Not found' : html);
      });
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

// ---------- entry ----------
async function handler(req, res) {
  let [rawPath, query = ''] = req.url.split('?');
  // Vercel rewrites /api/* to /api/index?__path=/api/...; restore the original path.
  const qp = new URLSearchParams(query);
  if (qp.has('__path')) {
    rawPath = qp.get('__path');
    qp.delete('__path');
    query = qp.toString();
  }
  let urlPath;
  try { urlPath = decodeURIComponent(rawPath); } catch { res.writeHead(400); return res.end(); }

  if (urlPath === '/api/config') return send(res, 200, { football: AF_KEY ? 'af' : 'espn', custom: !!custom, db: dbName });
  if (urlPath.startsWith('/api/af/')) return handleAf(res, urlPath.slice(8), query);
  if (urlPath.startsWith('/api/espn/')) return handleEspn(res, urlPath.slice(10), query);
  if (urlPath.startsWith('/api/custom') || urlPath.startsWith('/api/admin/')) {
    if (custom) return custom(req, res, urlPath, query);
    if (urlPath.startsWith('/api/admin/')) return send(res, 503, { error: 'No database connected. Add a Postgres database (DATABASE_URL) in Vercel.' });
    if (urlPath === '/api/custom/version') return send(res, 200, { v: '0' });
    return send(res, 200, { now: Date.now(), matches: [] });
  }
  if (urlPath.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
  if (urlPath === '/admin') return serveStatic(res, '/admin.html');
  serveStatic(res, urlPath);
}

module.exports = { handler, info: { football: AF_KEY ? 'API-Football' : 'ESPN', db: dbName } };
