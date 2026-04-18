/**
 * Persistent data layer (flat JSON files — no external DB needed).
 *
 * data/whitelist.json  → { "userIds": ["123", "456"] }
 * data/appeals.json    → { "threadId": { agree, disagree, discarded, targetUserId } }
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
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return fallback; }
}

function writeJSON(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ─── Whitelist ────────────────────────────────────────────────────────────────

function isWhitelisted(userId) {
  const db = readJSON(WHITELIST_FILE, { userIds: [] });
  return db.userIds.includes(String(userId));
}

function addToWhitelist(userId) {
  const db = readJSON(WHITELIST_FILE, { userIds: [] });
  if (!db.userIds.includes(String(userId))) {
    db.userIds.push(String(userId));
    writeJSON(WHITELIST_FILE, db);
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
    agree:       [],   // array of voter Discord IDs
    disagree:    [],
    discarded:   false,
  };
  writeJSON(APPEALS_FILE, db);
}

/**
 * Record a vote. Returns updated appeal object or null if invalid.
 * Prevents double-voting: switching sides removes the previous vote.
 */
function castVote(threadId, voterId, side) { // side: 'agree' | 'disagree'
  const db = readJSON(APPEALS_FILE, {});
  const appeal = db[String(threadId)];
  if (!appeal || appeal.discarded) return null;

  const opposite = side === 'agree' ? 'disagree' : 'agree';

  // Remove from opposite side if already voted there
  appeal[opposite] = appeal[opposite].filter(id => id !== String(voterId));

  // Toggle: if already voted same side, remove (unvote); otherwise add
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
