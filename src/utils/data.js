/**
 * Persistent data layer (flat JSON files — no external DB needed).
 *
 * data/whitelist.json  → { "userIds": ["123", "456"] }
 * data/appeals.json    → { "threadId": { agree, disagree, discarded, targetUserId } }
 *
 * Render note: the /data directory is created at runtime if it doesn't exist.
 * Never assume the files are pre-seeded.
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR       = path.join(__dirname, '../../data');
const WHITELIST_FILE = path.join(DATA_DIR, 'whitelist.json');
const APPEALS_FILE   = path.join(DATA_DIR, 'appeals.json');

// ─── helpers ─────────────────────────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      // File doesn't exist yet — write the fallback so it exists next time
      ensureDir();
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2), 'utf8');
      return fallback;
    }
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return fallback; // empty file
    const parsed = JSON.parse(raw);
    // Guard: if parsed result isn't the right shape, return fallback
    if (parsed === null || typeof parsed !== typeof fallback) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ─── Whitelist ────────────────────────────────────────────────────────────────

function isWhitelisted(userId) {
  const db = readJSON(WHITELIST_FILE, { userIds: [] });
  const list = Array.isArray(db?.userIds) ? db.userIds : [];
  return list.includes(String(userId));
}

function addToWhitelist(userId) {
  const db   = readJSON(WHITELIST_FILE, { userIds: [] });
  const list = Array.isArray(db?.userIds) ? db.userIds : [];
  if (!list.includes(String(userId))) {
    list.push(String(userId));
    writeJSON(WHITELIST_FILE, { userIds: list });
  }
}

// ─── Appeals (vote tracking) ─────────────────────────────────────────────────

function getAppeal(threadId) {
  const db = readJSON(APPEALS_FILE, {});
  return db[String(threadId)] || null;
}

function createAppeal(threadId, targetUserId) {
  const db = readJSON(APPEALS_FILE, {});
  db[String(threadId)] = {
    targetUserId: String(targetUserId),
    agree:       [],
    disagree:    [],
    discarded:   false,
  };
  writeJSON(APPEALS_FILE, db);
}

/**
 * Record a vote. Returns updated appeal object or null if invalid.
 * Switching sides removes the previous vote. Clicking the same side unvotes.
 */
function castVote(threadId, voterId, side) {
  const db = readJSON(APPEALS_FILE, {});
  const appeal = db[String(threadId)];
  if (!appeal || appeal.discarded) return null;

  // Ensure arrays exist even on old records
  if (!Array.isArray(appeal.agree))    appeal.agree    = [];
  if (!Array.isArray(appeal.disagree)) appeal.disagree = [];

  const opposite = side === 'agree' ? 'disagree' : 'agree';
  appeal[opposite] = appeal[opposite].filter(id => id !== String(voterId));

  if (appeal[side].includes(String(voterId))) {
    appeal[side] = appeal[side].filter(id => id !== String(voterId));
  } else {
    appeal[side].push(String(voterId));
  }

  writeJSON(APPEALS_FILE, db);
  return appeal;
}

function discardAppeal(threadId) {
  const db = readJSON(APPEALS_FILE, {});
  if (db[String(threadId)]) {
    db[String(threadId)].discarded = true;
    writeJSON(APPEALS_FILE, db);
  }
}

module.exports = {
  isWhitelisted,
  addToWhitelist,
  getAppeal,
  createAppeal,
  castVote,
  discardAppeal,
};
