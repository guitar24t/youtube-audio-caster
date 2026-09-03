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

module.exports = { TOKEN_BYTES, init, file, token, rotate, matches, mint, isLoopback, decide };
