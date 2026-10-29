// Hosted database: Postgres (used on Vercel; e.g. Neon from the Vercel Marketplace).
// `query(text, params)` must resolve to { rows }, as node-postgres' Pool#query does.

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    last_login BIGINT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (LOWER(username));
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    kickoff BIGINT NOT NULL,
    data TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS matches_kickoff ON matches (kickoff);
  CREATE TABLE IF NOT EXISTS activity (
    id SERIAL PRIMARY KEY,
    at BIGINT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    username TEXT NOT NULL,
    match_id TEXT,
    summary TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS activity_at ON activity (at);
`;

const num = (v) => (v == null ? v : Number(v));
const user = (r) => r && {
  ...r, id: num(r.id), token_version: num(r.token_version), created_at: num(r.created_at), last_login: num(r.last_login),
};

function createPgStore(query) {
  let ready = null;
  const q = async (text, params = []) => {
    await (ready ||= (async () => { for (const stmt of SCHEMA.split(';').map((x) => x.trim()).filter(Boolean)) await query(stmt); })()
      .catch((e) => { ready = null; throw e; }));
    return (await query(text, params)).rows;
  };
  const data = (rows) => rows.map((r) => JSON.parse(r.data));

  return {
    kind: 'postgres',
    async init() { await q('SELECT 1'); },
    async countUsers() { return num((await q('SELECT COUNT(*) AS n FROM users'))[0].n); },
    async countOwners() { return num((await q("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'"))[0].n); },
    async userByName(name) { return user((await q('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [name]))[0]) || null; },
    async userById(id) { return user((await q('SELECT * FROM users WHERE id = $1', [id]))[0]) || null; },
    async listUsers() {
      return (await q('SELECT id, username, name, role, created_at, last_login FROM users ORDER BY role DESC, LOWER(username)')).map(user);
    },
    async addUser(u) {
      await q('INSERT INTO users (username, name, pass_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)', [u.username, u.name, u.pass_hash, u.role, Date.now()]);
    },
    async updateUser(id, name, role) { await q('UPDATE users SET name = $1, role = $2 WHERE id = $3', [name, role, id]); },
    async setPassword(id, hash) { await q('UPDATE users SET pass_hash = $1, token_version = token_version + 1 WHERE id = $2', [hash, id]); },
    async touchLogin(id) { await q('UPDATE users SET last_login = $1 WHERE id = $2', [Date.now(), id]); },
    async deleteUser(id) { await q('DELETE FROM users WHERE id = $1', [id]); },
    async log(userId, username, matchId, summary) {
      await q('INSERT INTO activity (at, user_id, username, match_id, summary) VALUES ($1, $2, $3, $4, $5)', [Date.now(), userId, username, matchId, summary]);
    },
    async activity(limit) {
      return (await q('SELECT at, username, match_id, summary FROM activity ORDER BY id DESC LIMIT $1', [limit])).map((r) => ({ ...r, at: num(r.at) }));
    },
    async allMatches() { return data(await q('SELECT data FROM matches ORDER BY kickoff')); },
    async matchesBetween(from, to) { return data(await q('SELECT data FROM matches WHERE kickoff BETWEEN $1 AND $2 ORDER BY kickoff', [from, to])); },
    async getMatch(id) { return data(await q('SELECT data FROM matches WHERE id = $1', [id]))[0] || null; },
    async insertMatch(m, userId) {
      const now = Date.now();
      await q('INSERT INTO matches (id, kickoff, data, created_by, updated_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [m.id, new Date(m.kickoff).getTime(), JSON.stringify(m), userId, userId, m.createdAt || now, m.updatedAt || now]);
    },
    async updateMatch(m, userId) {
      await q('UPDATE matches SET kickoff = $1, data = $2, updated_by = $3, updated_at = $4 WHERE id = $5',
        [new Date(m.kickoff).getTime(), JSON.stringify(m), userId, m.updatedAt || Date.now(), m.id]);
    },
    async deleteMatch(id) { await q('DELETE FROM matches WHERE id = $1', [id]); },
    async countMatches() { return num((await q('SELECT COUNT(*) AS n FROM matches'))[0].n); },
    async version() { const r = (await q('SELECT COUNT(*) AS n, MAX(updated_at) AS t FROM matches'))[0]; return `${num(r.n)}.${num(r.t) || 0}`; },
  };
}

module.exports = { createPgStore };
