// Admin accounts and hand-entered matches.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SPORTS = new Set(['football', 'basketball', 'hockey', 'americanfootball', 'baseball']);
const STATUSES = new Set(['NS', '1H', 'HT', '2H', 'ET', 'BT', 'P', 'FT', 'AET', 'PEN', 'PST', 'CANC', 'SUSP', 'INT', 'ABD']);
const EVENT_TYPES = new Set(['goal', 'pen', 'og', 'miss', 'yc', 'rc', 'sub']);
const SCORING = new Set(['goal', 'pen', 'og']);
const ROLES = new Set(['owner', 'editor']);
const TOKEN_DAYS = 7;
const MIN_PASSWORD = 8;

// ---------- passwords & tokens ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(String(pw), salt, 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
const secret = () => process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || '';
const sign = (s) => crypto.createHmac('sha256', secret()).update(s).digest('hex');
function makeToken(u) {
  const body = `${u.id}.${u.token_version}.${Date.now() + TOKEN_DAYS * 864e5}`;
  return `${body}.${sign(body)}`;
}
const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, created_at: u.created_at, last_login: u.last_login });

const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 60e3);
  list.push(now);
  attempts.set(ip, list);
  if (attempts.size > 5000) attempts.clear();
  return list.length > 10;
}

// ---------- match clock ----------
// clock = { base, startedAt }: minute shown = base + whole minutes since startedAt + 1.
const PERIOD_CAP = { '1H': 45, '2H': 90, 'ET': 120 };
function currentMinute(m, now = Date.now()) {
  if (!m.clock?.startedAt) return null;
  const elapsed = m.clock.base + Math.floor((now - m.clock.startedAt) / 60000) + 1;
  const cap = PERIOD_CAP[m.status];
  if (cap && elapsed > cap) return { elapsed: cap, extra: elapsed - cap };
  return { elapsed, extra: null };
}

function applyStatus(m, status, now = Date.now()) {
  const prev = m.status;
  m.status = status;
  if (status === '1H') m.clock = { base: 0, startedAt: now };
  else if (status === '2H') m.clock = { base: 45, startedAt: now };
  else if (status === 'ET') m.clock = { base: prev === 'ET' ? m.clock?.base ?? 90 : 90, startedAt: now };
  else m.clock = null;
}

// ---------- validation ----------
const str = (v, max = 80) => (v == null ? '' : String(v).trim().slice(0, max));
const url = (v) => { const s = str(v, 400); return /^https?:\/\//i.test(s) ? s : ''; };
const int = (v, min = 0, max = 999) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null; };
// ISO 3166 country code as used by flagcdn.com, e.g. "gh", or UK nations like "gb-eng".
const flag = (v) => { const s = str(v, 6).toLowerCase(); return /^([a-z]{2}|gb-(eng|sct|wls|nir))$/.test(s) ? s : ''; };

function cleanDetails(b, existing = {}) {
  const out = { ...existing };
  if ('sport' in b) out.sport = SPORTS.has(b.sport) ? b.sport : 'football';
  if ('competition' in b) out.competition = str(b.competition) || 'Friendly';
  if ('country' in b) out.country = str(b.country, 40);
  if ('competitionLogo' in b) out.competitionLogo = url(b.competitionLogo);
  if ('competitionFlag' in b) out.competitionFlag = flag(b.competitionFlag);
  if ('venue' in b) out.venue = str(b.venue, 120);
  if ('referee' in b) out.referee = str(b.referee, 80);
  if ('round' in b) out.round = str(b.round, 60);
  if ('liveLabel' in b) out.liveLabel = str(b.liveLabel, 20);
  if ('kickoff' in b) {
    const d = new Date(b.kickoff);
    if (isNaN(d)) throw new Error('Kick-off date/time is not valid');
    out.kickoff = d.toISOString();
  }
  for (const side of ['home', 'away']) {
    if (b[side]) {
      out[side] = {
        name: str(b[side].name) || (existing[side]?.name ?? (side === 'home' ? 'Home' : 'Away')),
        logo: 'logo' in b[side] ? url(b[side].logo) : (existing[side]?.logo || ''),
        flag: 'flag' in b[side] ? flag(b[side].flag) : (existing[side]?.flag || ''),
      };
    }
  }
  if (b.score) out.score = { home: int(b.score.home) ?? out.score?.home ?? 0, away: int(b.score.away) ?? out.score?.away ?? 0 };
  if ('pens' in b) {
    out.pens = b.pens && (b.pens.home !== '' || b.pens.away !== '') ? { home: int(b.pens.home) ?? 0, away: int(b.pens.away) ?? 0 } : null;
  }
  if ('status' in b) {
    if (!STATUSES.has(b.status)) throw new Error('Unknown status');
    if (b.status !== out.status) applyStatus(out, b.status);
  }
  return out;
}

function cleanEvent(b, m) {
  const type = EVENT_TYPES.has(b.type) ? b.type : null;
  if (!type) throw new Error('Unknown event type');
  const team = b.team === 'away' ? 'away' : 'home';
  const now = currentMinute(m);
  const elapsed = int(b.minute, 0, 200) ?? now?.elapsed ?? 0;
  const extra = int(b.extra, 0, 30) ?? (b.minute == null || b.minute === '' ? now?.extra ?? null : null);
  return {
    id: crypto.randomBytes(5).toString('hex'),
    type, team, elapsed, extra: extra || null,
    player: str(b.player), assist: str(b.assist), note: str(b.note, 60),
  };
}
function cleanUsername(v) {
  const s = str(v, 40);
  if (!/^[a-z0-9._-]{3,40}$/i.test(s)) throw new Error('Username must be 3-40 letters, numbers, dots, dashes or underscores');
  return s;
}
function cleanPassword(v) {
  const s = String(v ?? '');
  if (s.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);
  if (s.length > 200) throw new Error('Password is too long');
  return s;
}

const vs = (m) => `${m.home?.name} v ${m.away?.name}`;
const publicMatch = (m) => ({ ...m, minute: currentMinute(m) });

// ---------- http helpers ----------
function readBody(req) {
  // Vercel hands functions an already-parsed body.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
    try { return Promise.resolve(JSON.parse(String(req.body) || '{}')); } catch { return Promise.reject(new Error('Invalid JSON')); }
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// ---------- handler ----------
function createCustom(store, { legacyJson } = {}) {
  let booted = null;
  const boot = () => (booted ||= (async () => {
    await store.init();
    if ((await store.countUsers()) === 0 && process.env.ADMIN_PASSWORD) {
      const username = (process.env.ADMIN_USERNAME || 'admin').trim();
      try {
        await store.addUser({ username, name: 'Owner', pass_hash: hashPassword(process.env.ADMIN_PASSWORD), role: 'owner' });
        console.log(`Admin: created owner account "${username}" (password from ADMIN_PASSWORD)`);
      } catch (e) {
        if (!/duplicate|unique|23505|409/i.test(e.message || '')) throw e;
      }
    }
    if (legacyJson && fs.existsSync(legacyJson) && (await store.countMatches()) === 0) {
      const list = JSON.parse(fs.readFileSync(legacyJson, 'utf8'));
      for (const m of list) await store.insertMatch(m, null);
      fs.renameSync(legacyJson, legacyJson + '.imported');
      console.log(`Admin: imported ${list.length} match(es) from ${path.basename(legacyJson)}`);
    }
  })().catch((e) => { booted = null; throw e; }));

  async function userFromToken(req) {
    const h = req.headers.authorization || '';
    const parts = (h.startsWith('Bearer ') ? h.slice(7) : '').split('.');
    if (parts.length !== 4 || !secret()) return null;
    const [id, ver, exp, mac] = parts;
    const want = sign(`${id}.${ver}.${exp}`);
    if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
    if (+exp < Date.now()) return null;
    const u = await store.userById(+id);
    return u && u.token_version === +ver ? u : null;
  }

  async function save(m, user, summary, isNew = false) {
    m.updatedAt = Date.now();
    if (isNew) await store.insertMatch(m, user.id); else await store.updateMatch(m, user.id);
    await store.log(user.id, user.username, m.id, summary);
  }

  async function route(req, res, urlPath, query) {
    // ----- public, read-only -----
    if (urlPath === '/api/custom/version') {
      json(res, 200, { v: await store.version() });
      return;
    }
    if (urlPath === '/api/custom') {
      const p = new URLSearchParams(query);
      const from = new Date(p.get('from') || 0).getTime();
      const to = p.get('to') ? new Date(p.get('to')).getTime() : 8.64e15;
      const list = await store.matchesBetween(isNaN(from) ? 0 : from, isNaN(to) ? 8.64e15 : to);
      json(res, 200, { now: Date.now(), matches: list.map(publicMatch) });
      return;
    }
    const one = urlPath.match(/^\/api\/custom\/([a-f0-9]+)$/);
    if (one) {
      const m = await store.getMatch(one[1]);
      json(res, m ? 200 : 404, m ? { now: Date.now(), match: publicMatch(m) } : { error: 'Not found' });
      return;
    }
    if (!urlPath.startsWith('/api/admin/')) return json(res, 404, { error: 'Not found' });

    // ----- login -----
    if (urlPath === '/api/admin/login' && req.method === 'POST') {
      if (tooManyAttempts(req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '')) {
        return json(res, 429, { error: 'Too many attempts. Wait a minute.' });
      }
      const b = await readBody(req);
      if ((await store.countUsers()) === 0) return json(res, 503, { error: 'No admin accounts yet: set ADMIN_PASSWORD and restart' });
      const u = await store.userByName(str(b.username, 40));
      if (!u || !checkPassword(b.password, u.pass_hash)) return json(res, 401, { error: 'Wrong username or password' });
      await store.touchLogin(u.id);
      return json(res, 200, { token: makeToken(u), user: publicUser(u) });
    }

    const me = await userFromToken(req);
    if (!me) return json(res, 401, { error: 'Please log in again' });

    // ----- my account -----
    if (urlPath === '/api/admin/me' && req.method === 'GET') return json(res, 200, { user: publicUser(me) });
    if (urlPath === '/api/admin/me/password' && req.method === 'POST') {
      const b = await readBody(req);
      if (!checkPassword(b.current, me.pass_hash)) throw new Error('Current password is wrong');
      await store.setPassword(me.id, hashPassword(cleanPassword(b.next)));
      await store.log(me.id, me.username, null, 'Changed own password');
      const fresh = await store.userById(me.id);
      return json(res, 200, { token: makeToken(fresh), user: publicUser(fresh) });
    }

    // ----- admin accounts (owners only) -----
    if (urlPath === '/api/admin/users' || urlPath.startsWith('/api/admin/users/')) {
      if (me.role !== 'owner') return json(res, 403, { error: 'Only an owner can manage admin accounts' });
      if (urlPath === '/api/admin/users' && req.method === 'GET') return json(res, 200, { users: await store.listUsers() });
      if (urlPath === '/api/admin/users' && req.method === 'POST') {
        const b = await readBody(req);
        const username = cleanUsername(b.username);
        if (await store.userByName(username)) throw new Error('That username is taken');
        const role = ROLES.has(b.role) ? b.role : 'editor';
        await store.addUser({ username, name: str(b.name, 60), pass_hash: hashPassword(cleanPassword(b.password)), role });
        await store.log(me.id, me.username, null, `Added ${role} "${username}"`);
        return json(res, 201, { users: await store.listUsers() });
      }
      const um = urlPath.match(/^\/api\/admin\/users\/(\d+)$/);
      const target = um && (await store.userById(+um[1]));
      if (!target) return json(res, 404, { error: 'Account not found' });
      if (req.method === 'PUT') {
        const b = await readBody(req);
        const role = ROLES.has(b.role) ? b.role : target.role;
        if (target.role === 'owner' && role !== 'owner' && (await store.countOwners()) <= 1) throw new Error('There must be at least one owner');
        await store.updateUser(target.id, 'name' in b ? str(b.name, 60) : target.name, role);
        if (b.password) await store.setPassword(target.id, hashPassword(cleanPassword(b.password)));
        await store.log(me.id, me.username, null, `Updated account "${target.username}"${b.password ? ' (new password)' : ''}`);
        return json(res, 200, { users: await store.listUsers() });
      }
      if (req.method === 'DELETE') {
        if (target.id === me.id) throw new Error('You cannot delete your own account');
        if (target.role === 'owner' && (await store.countOwners()) <= 1) throw new Error('There must be at least one owner');
        await store.deleteUser(target.id);
        await store.log(me.id, me.username, null, `Removed account "${target.username}"`);
        return json(res, 200, { users: await store.listUsers() });
      }
    }

    if (urlPath === '/api/admin/activity' && req.method === 'GET') return json(res, 200, { activity: await store.activity(100) });

    // ----- matches -----
    if (urlPath === '/api/admin/matches' && req.method === 'GET') {
      return json(res, 200, { now: Date.now(), matches: (await store.allMatches()).map(publicMatch) });
    }
    if (urlPath === '/api/admin/matches' && req.method === 'POST') {
      const b = await readBody(req);
      const m = cleanDetails({
        sport: 'football', competition: 'Friendly', country: '', competitionLogo: '', venue: '', referee: '', round: '', liveLabel: '',
        kickoff: new Date().toISOString(), home: { name: 'Home' }, away: { name: 'Away' }, score: { home: 0, away: 0 }, pens: null,
        ...b,
      }, { status: 'NS', clock: null, events: [] });
      if (!b.status) m.status = 'NS';
      m.id = crypto.randomBytes(6).toString('hex');
      m.createdAt = Date.now();
      await save(m, me, `Created ${vs(m)}`, true);
      return json(res, 201, { match: publicMatch(m) });
    }

    const mm = urlPath.match(/^\/api\/admin\/matches\/([a-f0-9]+)(\/.*)?$/);
    if (!mm) return json(res, 404, { error: 'Not found' });
    const m = await store.getMatch(mm[1]);
    if (!m) return json(res, 404, { error: 'Match not found' });
    const sub = mm[2] || '';

    if (!sub && req.method === 'PUT') {
      const updated = cleanDetails(await readBody(req), m);
      await save(updated, me, `Edited details of ${vs(updated)}`);
      return json(res, 200, { match: publicMatch(updated) });
    }
    if (!sub && req.method === 'DELETE') {
      await store.deleteMatch(m.id);
      await store.log(me.id, me.username, m.id, `Deleted ${vs(m)}`);
      return json(res, 200, { ok: true });
    }
    if (sub === '/action' && req.method === 'POST') {
      const b = await readBody(req);
      let summary;
      if (b.action === 'status') {
        if (!STATUSES.has(b.status)) throw new Error('Unknown status');
        applyStatus(m, b.status);
        summary = `${vs(m)}: status ${b.status}`;
      } else if (b.action === 'minute') {
        const min = int(b.minute, 1, 200);
        if (min == null) throw new Error('Enter a minute');
        m.clock = { base: min - 1, startedAt: Date.now() };
        if (!['1H', '2H', 'ET'].includes(m.status)) m.status = min > 90 ? 'ET' : min > 45 ? '2H' : '1H';
        summary = `${vs(m)}: clock set to ${min}'`;
      } else if (b.action === 'score') {
        const team = b.team === 'away' ? 'away' : 'home';
        m.score[team] = Math.max(0, (m.score[team] || 0) + (int(b.delta, -5, 5) || 0));
        summary = `${vs(m)}: score set to ${m.score.home}-${m.score.away}`;
      } else {
        throw new Error('Unknown action');
      }
      await save(m, me, summary);
      return json(res, 200, { match: publicMatch(m) });
    }
    if (sub === '/events' && req.method === 'POST') {
      const ev = cleanEvent(await readBody(req), m);
      m.events.push(ev);
      if (SCORING.has(ev.type)) m.score[ev.team] = (m.score[ev.team] || 0) + 1;
      await save(m, me, `${vs(m)}: ${ev.type} ${ev.player || ''} ${ev.elapsed}'`.replace(/\s+/g, ' '));
      return json(res, 201, { match: publicMatch(m) });
    }
    const evm = sub.match(/^\/events\/([a-f0-9]+)$/);
    if (evm && req.method === 'DELETE') {
      const i = m.events.findIndex((e) => e.id === evm[1]);
      if (i >= 0) {
        const [ev] = m.events.splice(i, 1);
        if (SCORING.has(ev.type)) m.score[ev.team] = Math.max(0, (m.score[ev.team] || 0) - 1);
        await save(m, me, `${vs(m)}: removed ${ev.type} ${ev.player || ''}`.replace(/\s+/g, ' '));
      }
      return json(res, 200, { match: publicMatch(m) });
    }
    json(res, 404, { error: 'Not found' });
  }

  return async function handle(req, res, urlPath, query) {
    try {
      await boot();
      await route(req, res, urlPath, query);
    } catch (e) {
      const msg = e.message || '';
      const setup = /^Database setup needed/.test(msg);
      const dbDown = setup || /ECONN|ENOTFOUND|timeout|aborted|database|relation|connect|fetch failed/i.test(msg);
      if (!res.headersSent) json(res, dbDown ? 503 : 400, { error: setup ? msg : dbDown ? 'Database unavailable' : (msg || 'Bad request') });
      if (dbDown) console.error('[custom]', msg);
    }
  };
}

module.exports = { createCustom };
