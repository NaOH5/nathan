/**
 * data.js — Persistent data layer (flat JSON files + in-memory cache).
 * NO external dependencies — only Node built-ins fs and path.
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR       = path.join(__dirname, '../../data');
const WHITELIST_FILE = path.join(DATA_DIR, 'whitelist.json');
const APPEALS_FILE   = path.join(DATA_DIR, 'appeals.json');

// ── In-memory cache (primary source of truth at runtime) ─────────────────────
const _cache = {
  whitelist: { userIds: [] },
  appeals:   {},
};

// ── Filesystem helpers (best-effort, never throw) ─────────────────────────────

function ensureDir() {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
}

function loadFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return fallback;
    return parsed;
  } catch (_) { return fallback; }
}

function saveFile(file, data) {
  try { ensureDir(); fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); } catch (_) {}
}

// ── Boot: load persisted data into cache ──────────────────────────────────────
(function boot() {
  const wl = loadFile(WHITELIST_FILE, { userIds: [] });
  _cache.whitelist.userIds = Array.isArray(wl.userIds) ? wl.userIds : [];
  const ap = loadFile(APPEALS_FILE, {});
  _cache.appeals = (ap && typeof ap === 'object') ? ap : {};
})();

// ── Whitelist ─────────────────────────────────────────────────────────────────

function isWhitelisted(userId) {
  return _cache.whitelist.userIds.includes(String(userId));
}

function addToWhitelist(userId) {
  const id = String(userId);
  if (!_cache.whitelist.userIds.includes(id)) {
    _cache.whitelist.userIds.push(id);
    saveFile(WHITELIST_FILE, _cache.whitelist);
  }
}

// ── Appeals ───────────────────────────────────────────────────────────────────

function getAppeal(threadId) {
  return _cache.appeals[String(threadId)] || null;
}

function createAppeal(threadId, targetUserId) {
  _cache.appeals[String(threadId)] = {
    targetUserId: String(targetUserId),
    agree: [], disagree: [], discarded: false,
  };
  saveFile(APPEALS_FILE, _cache.appeals);
}

function castVote(threadId, voterId, side) {
  const appeal = _cache.appeals[String(threadId)];
  if (!appeal || appeal.discarded) return null;
  if (!Array.isArray(appeal.agree))    appeal.agree    = [];
  if (!Array.isArray(appeal.disagree)) appeal.disagree = [];
  const opposite = side === 'agree' ? 'disagree' : 'agree';
  appeal[opposite] = appeal[opposite].filter(id => id !== String(voterId));
  if (appeal[side].includes(String(voterId))) {
    appeal[side] = appeal[side].filter(id => id !== String(voterId));
  } else {
    appeal[side].push(String(voterId));
  }
  saveFile(APPEALS_FILE, _cache.appeals);
  return appeal;
}

function discardAppeal(threadId) {
  const appeal = _cache.appeals[String(threadId)];
  if (appeal) { appeal.discarded = true; saveFile(APPEALS_FILE, _cache.appeals); }
}

module.exports = { isWhitelisted, addToWhitelist, getAppeal, createAppeal, castVote, discardAppeal };
