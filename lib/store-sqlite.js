// Local database: SQLite file at data/scorenest.db (built into Node 22.5+, no install).
const fs = require('fs');
const path = require('path');

const emitWarning = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  if (String(w?.message || w).includes('SQLite')) return;
  return emitWarning.call(process, w, ...rest);
};
const { DatabaseSync } = require('node:sqlite');

function createSqliteStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'scorenest.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL DEFAULT '',
      pass_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
      token_version INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_login INTEGER
    );
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      kickoff INTEGER NOT NULL,
      data TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS matches_kickoff ON matches(kickoff);
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT NOT NULL,
      match_id TEXT,
      summary TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS activity_at ON activity(at);
  `);

  const p = (sql) => db.prepare(sql);
  const s = {
    countUsers: p('SELECT COUNT(*) AS n FROM users'),
    countOwners: p("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'"),
    userByName: p('SELECT * FROM users WHERE username = ?'),
    userById: p('SELECT * FROM users WHERE id = ?'),
    listUsers: p('SELECT id, username, name, role, created_at, last_login FROM users ORDER BY role DESC, username'),
    addUser: p('INSERT INTO users (username, name, pass_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'),
    updateUser: p('UPDATE users SET name = ?, role = ? WHERE id = ?'),
    setPassword: p('UPDATE users SET pass_hash = ?, token_version = token_version + 1 WHERE id = ?'),
    touchLogin: p('UPDATE users SET last_login = ? WHERE id = ?'),
    deleteUser: p('DELETE FROM users WHERE id = ?'),
    log: p('INSERT INTO activity (at, user_id, username, match_id, summary) VALUES (?, ?, ?, ?, ?)'),
    activity: p('SELECT at, username, match_id, summary FROM activity ORDER BY id DESC LIMIT ?'),
    allMatches: p('SELECT data FROM matches ORDER BY kickoff'),
    matchesBetween: p('SELECT data FROM matches WHERE kickoff BETWEEN ? AND ? ORDER BY kickoff'),
    getMatch: p('SELECT data FROM matches WHERE id = ?'),
    insertMatch: p('INSERT INTO matches (id, kickoff, data, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    updateMatch: p('UPDATE matches SET kickoff = ?, data = ?, updated_by = ?, updated_at = ? WHERE id = ?'),
    deleteMatch: p('DELETE FROM matches WHERE id = ?'),
    countMatches: p('SELECT COUNT(*) AS n FROM matches'),
    version: p('SELECT COUNT(*) AS n, MAX(updated_at) AS t FROM matches'),
  };
  const data = (row) => (row ? JSON.parse(row.data) : null);

  return {
    kind: 'sqlite',
    async init() {},
    async countUsers() { return s.countUsers.get().n; },
    async countOwners() { return s.countOwners.get().n; },
    async userByName(name) { return s.userByName.get(name) || null; },
    async userById(id) { return s.userById.get(id) || null; },
    async listUsers() { return s.listUsers.all(); },
    async addUser(u) { s.addUser.run(u.username, u.name, u.pass_hash, u.role, Date.now()); },
    async updateUser(id, name, role) { s.updateUser.run(name, role, id); },
    async setPassword(id, hash) { s.setPassword.run(hash, id); },
    async touchLogin(id) { s.touchLogin.run(Date.now(), id); },
    async deleteUser(id) { s.deleteUser.run(id); },
    async log(userId, username, matchId, summary) { s.log.run(Date.now(), userId, username, matchId, summary); },
    async activity(limit) { return s.activity.all(limit); },
    async allMatches() { return s.allMatches.all().map(data); },
    async matchesBetween(from, to) { return s.matchesBetween.all(from, to).map(data); },
    async getMatch(id) { return data(s.getMatch.get(id)); },
    async insertMatch(m, userId) {
      const now = Date.now();
      s.insertMatch.run(m.id, new Date(m.kickoff).getTime(), JSON.stringify(m), userId, userId, m.createdAt || now, m.updatedAt || now);
    },
    async updateMatch(m, userId) { s.updateMatch.run(new Date(m.kickoff).getTime(), JSON.stringify(m), userId, m.updatedAt || Date.now(), m.id); },
    async deleteMatch(id) { s.deleteMatch.run(id); },
    async countMatches() { return s.countMatches.get().n; },
    async version() { const r = s.version.get(); return `${r.n}.${r.t || 0}`; },
  };
}

module.exports = { createSqliteStore };
