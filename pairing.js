'use strict';
/* The shared secret a phone proves it knows before it can drive the speakers.

   Nothing here is about who you are - there is one user and one house. It only
   answers "is this the browser I handed the code to, or is it someone else on
   the coffee-shop wifi". So: one long random token, kept on disk, compared in
   constant time. No accounts, no expiry, no rotation schedule; rotate() exists
   so a token that has been shown on a screen in a room full of people can be
   thrown away deliberately.

   Deliberately NOT in settings.json. That file is booleans the UI renders, it
   is merged and rewritten on every preference change, and a secret has no
   business travelling through the same code path as a checkbox. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* 32 bytes. The token is typed by nobody - it travels in a url or a QR code -
   so there is no reason to trade length for readability. */
const TOKEN_BYTES = 32;

let FILE = null;
let cached = null;

const init = dir => { FILE = path.join(dir, 'pairing.json'); cached = null; };
const file = () => FILE;

function mint() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function write(token) {
  /* Same write-then-rename as the other stores, so a half-written file is never
     left where the next start would read it and lock the phone out. */
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify({ token }, null, 1), { mode: 0o600 });
  fs.renameSync(FILE + '.tmp', FILE);
}

/* Generated on first use rather than at install, so a machine that never turns
   network access on never has a secret sitting on its disk. */
function token() {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (parsed && typeof parsed.token === 'string' && parsed.token.length >= 32) {
      cached = parsed.token;
      return cached;
    }
  } catch { /* missing, corrupt, or too short: mint a new one below */ }
  cached = mint();
  try { write(cached); }
  catch (e) { console.error('[pairing] could not save the pairing token:', e.message); }
  return cached;
}

function rotate() {
  cached = mint();
  try { write(cached); }
  catch (e) { console.error('[pairing] could not save the pairing token:', e.message); }
  return cached;
}

/* Constant time, so a wrong guess cannot be narrowed down by how long it took
   to be rejected. timingSafeEqual throws on a length mismatch, which is itself
   an early return, so pad the comparison to a fixed width first. */
function matches(supplied) {
  const expected = token();
  const a = Buffer.alloc(128);
  const b = Buffer.alloc(128);
  a.write(String(supplied == null ? '' : supplied).slice(0, 128));
  b.write(expected.slice(0, 128));
  return crypto.timingSafeEqual(a, b);
}

/* An address is loopback or it is not, and that is the only question that
   matters here - a socket bound to 127.0.0.1 cannot receive anything else, so
   when this says "not loopback" the packet genuinely came off the network.
   ::ffff:127.0.0.1 is the same machine arriving through a dual-stack socket. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const isLoopback = address => LOOPBACK.has(String(address == null ? '' : address));

/* The access rule, as data rather than as control flow in a middleware, so the
   three ways in can be stated and tested without a socket to fake:

     the app talking to itself        -> always allowed, no token
     a device on the network, off     -> 403, and say the door is shut rather
                                         than implying a wrong token
     a device on the network, on      -> 401 unless it proves it was paired

   The order matters: answering 401 while the feature is off would tell a
   scanner that a valid token exists to be found. */
function decide({ loopback, networkEnabled, tokenValid }) {
  if (loopback) return { allow: true };
  if (!networkEnabled) {
    return { allow: false, status: 403, error: 'this app is not accepting connections from the network' };
  }
  if (!tokenValid) return { allow: false, status: 401, error: 'pair this device first' };
  return { allow: true };
}

/* ---------- claiming, for a device that cannot be handed a link ----------

   A phone app has no address bar to paste 64 hex characters into, so it trades
   a short code for the real token instead. The code is what makes this safe
   rather than the transport:

     - it only exists while someone is looking at the pairing screen
     - it dies after THREE MINUTES, or the first successful claim, or ten wrong
       guesses, whichever comes first
     - the alphabet has no O/0/I/1, because a code that is read aloud across a
       room and mistyped costs an attempt

   32 characters, 8 long, is 2^40 possibilities against ten guesses in three
   minutes. The attempt limit is doing the work here, not the entropy. */
const CLAIM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CLAIM_LENGTH = 8;
const CLAIM_TTL_MS = 3 * 60 * 1000;
const CLAIM_MAX_ATTEMPTS = 10;

let claim = null;

function makeCode() {
  const bytes = crypto.randomBytes(CLAIM_LENGTH);
  let out = '';
  /* rejection-free because the alphabet is exactly 32 long, so five bits map
     onto it with no modulo bias */
  for (const byte of bytes) out += CLAIM_ALPHABET[byte & 31];
  return out;
}

function openClaim(now = Date.now()) {
  claim = { code: makeCode(), expiresAt: now + CLAIM_TTL_MS, attempts: 0 };
  return { code: claim.code, expires_at: claim.expiresAt };
}

function closeClaim() { claim = null; }

function claimState(now = Date.now()) {
  if (!claim) return null;
  if (now >= claim.expiresAt) { claim = null; return null; }
  return { code: claim.code, expires_at: claim.expiresAt,
    attempts_left: CLAIM_MAX_ATTEMPTS - claim.attempts };
}

/* Returns the token on success and null on every kind of failure, without
   saying which kind - "wrong code", "expired" and "no code open" are the same
   answer to anyone guessing. */
function redeem(supplied, now = Date.now()) {
  if (!claim || now >= claim.expiresAt) { claim = null; return null; }
  claim.attempts += 1;
  if (claim.attempts > CLAIM_MAX_ATTEMPTS) { claim = null; return null; }
  const given = Buffer.alloc(CLAIM_LENGTH);
  const want = Buffer.alloc(CLAIM_LENGTH);
  given.write(String(supplied == null ? '' : supplied).trim().toUpperCase().slice(0, CLAIM_LENGTH));
  want.write(claim.code);
  if (!crypto.timingSafeEqual(given, want)) return null;
  claim = null;                       // one use only
  return token();
}

module.exports = {
  TOKEN_BYTES, init, file, token, rotate, matches, mint, isLoopback, decide,
  CLAIM_ALPHABET, CLAIM_LENGTH, CLAIM_TTL_MS, CLAIM_MAX_ATTEMPTS,
  openClaim, closeClaim, claimState, redeem,
};
