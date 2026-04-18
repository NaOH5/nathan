/**
 * API Wrappers
 * Rotector  → https://roscoe.rotector.com/v1/
 * TaseAPI   → https://api.tasebot.org/v2/
 *
 * Both use: Authorization: Bearer <KEY>
 * Any non-2xx / network failure returns null so callers can
 * distinguish "not found / clean" from "API down".
 */

const axios = require('axios');
const config = require('../../config');

// ─── shared timeout ──────────────────────────────────────────────────────────
const TIMEOUT = 8000; // 8 s per request

// ─── Rotector helpers ─────────────────────────────────────────────────────────

const rotectorHeaders = () => ({
  Authorization: `Bearer ${config.ROTECTOR_API_KEY}`,
  'Content-Type': 'application/json',
});

/**
 * Check a Discord user ID against Rotector.
 * @returns {object|null}  data object on success, null on error / 404
 */
async function checkDiscordUser(discordId) {
  try {
    const { data } = await axios.get(
      `${config.ROTECTOR_BASE}/lookup/discord/user/${discordId}`,
      { headers: rotectorHeaders(), timeout: TIMEOUT }
    );
    if (data?.success && data?.data) return data.data;
    return null;
  } catch (err) {
    if (err.response?.status === 404) return null; // user not in system = clean
    throw err; // re-throw network/server errors so callers can alert
  }
}

/**
 * Check a Roblox user ID against Rotector.
 * @returns {object|null}
 */
async function checkRobloxUser(robloxId) {
  try {
    const { data } = await axios.get(
      `${config.ROTECTOR_BASE}/lookup/roblox/user/${robloxId}`,
      { headers: rotectorHeaders(), timeout: TIMEOUT }
    );
    if (data?.success && data?.data) return data.data;
    return null;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

// ─── TaseAPI ─────────────────────────────────────────────────────────────────

const taseHeaders = () => ({
  Authorization: `Bearer ${config.TASE_API_KEY}`,
  'Content-Type': 'application/json',
});

/**
 * Check a user ID against TaseAPI.
 * TaseAPI is noted as unstable, so we handle every failure gracefully.
 * @returns {{ found: boolean, raw: object }|null}
 *   null  = API down / timeout
 *   { found: false } = user not in database
 *   { found: true, raw } = user flagged, raw contains the full response
 */
async function checkTaseUser(userId) {
  try {
    const { data } = await axios.get(
      `${config.TASE_BASE}/check/${userId}`,
      { headers: taseHeaders(), timeout: TIMEOUT }
    );

    if (!data) return null;

    // TaseAPI response shape is undocumented / unstable.
    // We try common patterns; fall back to returning raw data.
    const found =
      data.found === true ||
      data.flagged === true ||
      data.detected === true ||
      (Array.isArray(data.servers) && data.servers.length > 0) ||
      (typeof data.status === 'string' && data.status.toLowerCase() !== 'clean');

    return { found, raw: data };
  } catch (err) {
    if (err.response?.status === 404) return { found: false, raw: null };
    // Any other error (500, network, timeout) → signal "unavailable"
    return null;
  }
}

module.exports = { checkDiscordUser, checkRobloxUser, checkTaseUser };
