'use strict';
/* The phone app is mostly the desktop's own page, bundled. What is genuinely
   new is the screen in front of it - which computer, and what is the password -
   and the part of that worth testing is the parsing, because it is where a
   person standing in a kitchen typing an address gets stuck. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const H = require('../mobile/www/host.js');

test('an address is accepted however somebody typed it', () => {
  const expected = 'http://192.168.1.5:8765';
  for (const typed of [
    '192.168.1.5',
    '192.168.1.5:8765',
    'http://192.168.1.5',
    'http://192.168.1.5:8765',
    'http://192.168.1.5:8765/',
    '  192.168.1.5  ',
    'HTTP://192.168.1.5',
  ]) {
    assert.equal(H.normalizeHost(typed), expected, `rejected or mangled: ${JSON.stringify(typed)}`);
  }
  // an explicit port is always kept, and a name works as well as an address
  assert.equal(H.normalizeHost('192.168.1.5:9000'), 'http://192.168.1.5:9000');
  assert.equal(H.normalizeHost('caster.local'), 'http://caster.local:8765');
});

test('REGRESSION: a scheme that is not http is refused, not turned into a hostname', () => {
  /* "ftp://box" used to become the host "ftp", which then failed to connect
     with a message about the wrong thing entirely. */
  for (const bad of ['ftp://box', 'nonsense://x', 'file:///etc/passwd', 'javascript:alert(1)']) {
    assert.equal(H.normalizeHost(bad), null, `accepted ${bad}`);
  }
});

test('junk is refused rather than guessed at', () => {
  for (const bad of ['', '   ', null, undefined, 'http://', '://', {}, []]) {
    assert.equal(H.normalizeHost(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test('a pairing link carries both the address and the password', () => {
  assert.deepEqual(H.readPairingLink('http://192.168.1.5:8765/?t=abc123'),
    { host: 'http://192.168.1.5:8765', token: 'abc123' });
  // the real thing, as the desktop builds it
  const real = H.readPairingLink('http://10.0.0.9:8765/?t=' + 'a'.repeat(64));
  assert.equal(real.host, 'http://10.0.0.9:8765');
  assert.equal(real.token.length, 64);
});

test('a link with no token in it is not a pairing link', () => {
  for (const bad of ['http://192.168.1.5:8765/', 'http://192.168.1.5:8765/?x=1',
                     'not a url', '', null, 'ftp://box/?t=abc']) {
    assert.equal(H.readPairingLink(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test('the phone bundles the desktop page rather than pointing a webview at it', () => {
  /* capacitor.config.json must not grow a server.url: that turns the app into a
     window onto a remote page, which is both a review problem and a blank
     screen whenever the computer is asleep. */
  const config = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'mobile', 'capacitor.config.json'), 'utf8'));
  assert.equal(config.webDir, 'www');
  assert.ok(!config.server || !config.server.url,
    'capacitor.config.json points the app at a remote url instead of bundling it');
});

test('the shell ships the files it loads', () => {
  const www = path.join(__dirname, '..', 'mobile', 'www');
  const html = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
  for (const src of [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1])) {
    assert.ok(fs.existsSync(path.join(www, src)), `index.html loads ${src}, which is not there`);
  }
});
