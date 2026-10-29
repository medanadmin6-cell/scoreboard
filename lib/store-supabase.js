// Supabase database through its REST API (PostgREST), using the project's service-role key.
// Tables are prefixed `sn_` so they can live next to another app's tables; create them once
// with supabase/schema.sql.

const SETUP_HINT = 'Database setup needed: run supabase/schema.sql in the Supabase SQL editor';

function createSupabaseStore(projectUrl, serviceKey) {
  const base = projectUrl.replace(/\/+$/, '') + '/rest/v1/';
  const enc = encodeURIComponent;

  async function call(method, path, { body, prefer } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if (!res.ok) {
      let info = {};
      try { info = JSON.parse(text); } catch { /* not JSON */ }
      if (info.code === '42P01' || info.code === 'PGRST205' || /could not find the table/i.test(info.message || '')) {
        throw new Error(SETUP_HINT);
      }
      throw new Error(`database ${res.status}: ${info.message || text.slice(0, 200)}`);
    }
    return { rows: text ? JSON.parse(text) : [], headers: res.headers };
  }

  const get = async (path) => (await call('GET', path)).rows;
  async function count(path) {
    const { headers } = await call('GET', `${path}&limit=1`, { prefer: 'count=exact' });
    const total = (headers.get('content-range') || '').split('/')[1];
    return Number(total) || 0;
  }
  const first = async (path) => (await get(`${path}&limit=1`))[0] || null;

  return {
    kind: 'supabase',
    async init() { await get('sn_admins?select=id&limit=1'); },

    async countUsers() { return count('sn_admins?select=id'); },
    async countOwners() { return count('sn_admins?select=id&role=eq.owner'); },
    async userByName(name) { return first(`sn_admins?select=*&username_key=eq.${enc(String(name).toLowerCase())}`); },
    async userById(id) { return first(`sn_admins?select=*&id=eq.${enc(id)}`); },
    async listUsers() {
      return get('sn_admins?select=id,username,name,role,created_at,last_login&order=role.desc,username_key.asc');
    },
    async addUser(u) {
      await call('POST', 'sn_admins', {
        body: { username: u.username, username_key: u.username.toLowerCase(), name: u.name, pass_hash: u.pass_hash, role: u.role, created_at: Date.now() },
        prefer: 'return=minimal',
      });
    },
    async updateUser(id, name, role) { await call('PATCH', `sn_admins?id=eq.${enc(id)}`, { body: { name, role }, prefer: 'return=minimal' }); },
    async setPassword(id, hash) {
      const u = await first(`sn_admins?select=token_version&id=eq.${enc(id)}`);
      await call('PATCH', `sn_admins?id=eq.${enc(id)}`, { body: { pass_hash: hash, token_version: (u?.token_version || 0) + 1 }, prefer: 'return=minimal' });
    },
    async touchLogin(id) { await call('PATCH', `sn_admins?id=eq.${enc(id)}`, { body: { last_login: Date.now() }, prefer: 'return=minimal' }); },
    async deleteUser(id) { await call('DELETE', `sn_admins?id=eq.${enc(id)}`, { prefer: 'return=minimal' }); },

    async log(userId, username, matchId, summary) {
      await call('POST', 'sn_activity', { body: { at: Date.now(), user_id: userId, username, match_id: matchId, summary }, prefer: 'return=minimal' });
    },
    async activity(limit) { return get(`sn_activity?select=at,username,match_id,summary&order=id.desc&limit=${limit}`); },

    async allMatches() { return (await get('sn_matches?select=data&order=kickoff.asc')).map((r) => r.data); },
    async matchesBetween(from, to) {
      return (await get(`sn_matches?select=data&kickoff=gte.${Math.floor(from)}&kickoff=lte.${Math.floor(Math.min(to, 8.64e15))}&order=kickoff.asc`)).map((r) => r.data);
    },
    async getMatch(id) { return (await first(`sn_matches?select=data&id=eq.${enc(id)}`))?.data || null; },
    async insertMatch(m, userId) {
      const now = Date.now();
      await call('POST', 'sn_matches', {
        body: { id: m.id, kickoff: new Date(m.kickoff).getTime(), data: m, created_by: userId, updated_by: userId, created_at: m.createdAt || now, updated_at: m.updatedAt || now },
        prefer: 'return=minimal',
      });
    },
    async updateMatch(m, userId) {
      await call('PATCH', `sn_matches?id=eq.${enc(m.id)}`, {
        body: { kickoff: new Date(m.kickoff).getTime(), data: m, updated_by: userId, updated_at: m.updatedAt || Date.now() },
        prefer: 'return=minimal',
      });
    },
    async deleteMatch(id) { await call('DELETE', `sn_matches?id=eq.${enc(id)}`, { prefer: 'return=minimal' }); },
    async countMatches() { return count('sn_matches?select=id'); },
    async version() {
      const { rows, headers } = await call('GET', 'sn_matches?select=updated_at&order=updated_at.desc&limit=1', { prefer: 'count=exact' });
      return `${(headers.get('content-range') || '').split('/')[1] || 0}.${rows[0]?.updated_at || 0}`;
    },
  };
}

module.exports = { createSupabaseStore, SETUP_HINT };
