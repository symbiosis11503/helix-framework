/**
 * Two-Factor Authentication (2FA) — TOTP + Backup Codes
 *
 * Supports multiple authenticator apps (Google/Authy/Microsoft/etc.)
 * using standard TOTP (RFC 6238). Zero external dependencies.
 *
 * Flow:
 *   1. User enables 2FA → generate secret + QR code URI
 *   2. User scans QR with any authenticator app
 *   3. User verifies with 6-digit code to confirm setup
 *   4. On login: after password/token check, require 6-digit TOTP
 *   5. Backup codes available for account recovery
 *
 * Shared core: works with both PG and SQLite via db.js adapter.
 */

import { query, getType } from './db.js';
import { createHmac, randomBytes, randomInt } from 'crypto';

// ========== Constants ==========

const TOTP_PERIOD = 30;       // seconds per code
const TOTP_DIGITS = 6;        // code length
const TOTP_WINDOW = 1;        // allow ±1 period drift
const BACKUP_CODE_COUNT = 8;  // number of backup codes
const ISSUER = 'Helix';       // shown in authenticator app

// ========== Init ==========

export async function initTwoFactorTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS two_factor (
      user_id TEXT PRIMARY KEY,
      secret TEXT NOT NULL,
      enabled INTEGER DEFAULT 0,
      backup_codes TEXT,
      verified_at TEXT,
      created_at TEXT
    )
  `);
}

// ========== Setup Flow ==========

/**
 * Generate 2FA secret for a user
 * Returns secret + QR code URI for scanning
 * @param {string} userId
 * @param {string} [accountName] - shown in authenticator app
 * @returns {{ secret, qrUri, backupCodes }}
 */
export async function setup(userId, accountName = null) {
  const secret = generateSecret();
  const backupCodes = generateBackupCodes();
  const label = accountName || userId;

  const qrUri = buildOtpAuthUri(secret, label);

  const now = getType() === 'pg' ? 'now()' : "datetime('now')";

  // Upsert: replace if exists
  const existing = await query('SELECT user_id FROM two_factor WHERE user_id = $1', [userId]);
  if (existing.rows.length > 0) {
    await query(
      `UPDATE two_factor SET secret = $1, enabled = 0, backup_codes = $2, verified_at = NULL, created_at = ${now} WHERE user_id = $3`,
      [secret, JSON.stringify(backupCodes), userId]
    );
  } else {
    await query(
      `INSERT INTO two_factor (user_id, secret, enabled, backup_codes, created_at)
       VALUES ($1, $2, 0, $3, ${now})`,
      [userId, secret, JSON.stringify(backupCodes)]
    );
  }

  return {
    secret,
    qrUri,
    backupCodes,
    instructions: `Scan the QR code with Google Authenticator, Authy, or any TOTP app. Then verify with a 6-digit code.`,
  };
}

/**
 * Verify setup — user provides the first TOTP code to confirm
 * @param {string} userId
 * @param {string} code - 6-digit TOTP code
 * @returns {{ verified: boolean }}
 */
export async function verifySetup(userId, code) {
  const row = await getRecord(userId);
  if (!row) return { verified: false, error: '2FA not set up' };
  if (row.enabled) return { verified: false, error: '2FA already enabled' };

  const valid = verifyTOTP(row.secret, code);
  if (!valid) return { verified: false, error: 'Invalid code' };

  const now = getType() === 'pg' ? 'now()' : "datetime('now')";
  await query(
    `UPDATE two_factor SET enabled = 1, verified_at = ${now} WHERE user_id = $1`,
    [userId]
  );

  return { verified: true };
}

// ========== Verification ==========

/**
 * Verify a TOTP code during login
 * @param {string} userId
 * @param {string} code - 6-digit code or backup code
 * @returns {{ valid: boolean, method?: 'totp' | 'backup' }}
 */
export async function verify(userId, code) {
  const row = await getRecord(userId);
  if (!row || !row.enabled) return { valid: false, error: '2FA not enabled' };

  // Try TOTP first
  if (verifyTOTP(row.secret, code)) {
    return { valid: true, method: 'totp' };
  }

  // Try backup code
  const backupCodes = JSON.parse(row.backup_codes || '[]');
  const codeIndex = backupCodes.indexOf(code);
  if (codeIndex !== -1) {
    // Consume backup code (one-time use)
    backupCodes.splice(codeIndex, 1);
    await query(
      'UPDATE two_factor SET backup_codes = $1 WHERE user_id = $2',
      [JSON.stringify(backupCodes), userId]
    );
    return { valid: true, method: 'backup', remainingBackupCodes: backupCodes.length };
  }

  return { valid: false, error: 'Invalid code' };
}

/**
 * Check if user has 2FA enabled
 */
export async function isEnabled(userId) {
  const row = await getRecord(userId);
  return { enabled: !!(row && row.enabled) };
}

// ========== Management ==========

/**
 * Disable 2FA for a user
 */
export async function disable(userId) {
  await query('DELETE FROM two_factor WHERE user_id = $1', [userId]);
  return { disabled: true };
}

/**
 * Regenerate backup codes
 */
export async function regenerateBackupCodes(userId) {
  const row = await getRecord(userId);
  if (!row || !row.enabled) return { error: '2FA not enabled' };

  const backupCodes = generateBackupCodes();
  await query(
    'UPDATE two_factor SET backup_codes = $1 WHERE user_id = $2',
    [JSON.stringify(backupCodes), userId]
  );

  return { backupCodes };
}

/**
 * Get 2FA status for a user (no secrets exposed)
 */
export async function getStatus(userId) {
  const row = await getRecord(userId);
  if (!row) return { setup: false, enabled: false };

  const backupCodes = JSON.parse(row.backup_codes || '[]');
  return {
    setup: true,
    enabled: !!row.enabled,
    verifiedAt: row.verified_at,
    backupCodesRemaining: backupCodes.length,
  };
}

// ========== TOTP Core (RFC 6238) ==========

/**
 * Generate TOTP code for current time
 */
export function generateTOTP(secret, time = null) {
  const t = time || Math.floor(Date.now() / 1000);
  const counter = Math.floor(t / TOTP_PERIOD);
  return hotp(secret, counter);
}

/**
 * Verify TOTP code with time window tolerance
 */
function verifyTOTP(secret, code) {
  const t = Math.floor(Date.now() / 1000);
  const counter = Math.floor(t / TOTP_PERIOD);

  for (let i = -TOTP_WINDOW; i <= TOTP_WINDOW; i++) {
    const expected = hotp(secret, counter + i);
    if (expected === code) return true;
  }
  return false;
}

/**
 * HOTP (RFC 4226) — core OTP algorithm
 */
function hotp(secret, counter) {
  const secretBytes = base32Decode(secret);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmacResult = createHmac('sha1', secretBytes).update(counterBuf).digest();

  // Dynamic truncation
  const offset = hmacResult[hmacResult.length - 1] & 0x0f;
  const binary =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);

  const otp = binary % Math.pow(10, TOTP_DIGITS);
  return otp.toString().padStart(TOTP_DIGITS, '0');
}

// ========== Helpers ==========

function generateSecret() {
  // 20 bytes = 160 bits, standard for TOTP
  const bytes = randomBytes(20);
  return base32Encode(bytes);
}

function generateBackupCodes() {
  const codes = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    // 8-digit numeric backup codes
    codes.push(randomInt(10000000, 99999999).toString());
  }
  return codes;
}

function buildOtpAuthUri(secret, label) {
  const encodedLabel = encodeURIComponent(label);
  const encodedIssuer = encodeURIComponent(ISSUER);
  return `otpauth://totp/${encodedIssuer}:${encodedLabel}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
}

async function getRecord(userId) {
  const r = await query('SELECT * FROM two_factor WHERE user_id = $1', [userId]);
  return r.rows[0] || null;
}

// ========== Base32 ==========

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let result = '';
  let bits = 0;
  let value = 0;

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_CHARS[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 0x1f];
  }
  return result;
}

function base32Decode(str) {
  const cleanStr = str.replace(/[= ]/g, '').toUpperCase();
  const bytes = [];
  let bits = 0;
  let value = 0;

  for (const char of cleanStr) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export default {
  initTwoFactorTables,
  setup, verifySetup,
  verify, isEnabled,
  disable, regenerateBackupCodes, getStatus,
  generateTOTP,
};
