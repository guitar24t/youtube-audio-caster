'use strict';
/* Turning what somebody typed into an address the app can call.

   People will type "192.168.1.5", paste "http://192.168.1.5:8765/?t=abc" off
   the computer's screen, and produce everything in between. Refusing a
   nearly-right address is the most annoying possible failure in an app whose
   entire first screen is "which computer" - so this accepts the lot and
   normalises, and only rejects what genuinely has no host in it.

   Loaded by shell.js in the webview and by the test suite in node, which is why
   it ends the way it does. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CasterHost = api;
}(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_PORT = '8765';

  /* Returns "http://host:port" with no trailing slash, or null. */
  function normalizeHost(raw) {
    let text = String(raw == null ? '' : raw).trim();
    if (!text) return null;
    /* A scheme that is not http(s) is a mistake worth reporting, not something
       to prepend http:// onto - "ftp://box" would otherwise quietly become the
       host "ftp". A bare address has no scheme at all and does get one. */
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
      if (!/^https?:\/\//i.test(text)) return null;
    } else {
      text = 'http://' + text;
    }
    let url;
    try { url = new URL(text); } catch (e) { return null; }
    if (!url.hostname) return null;
    /* A bare address means the port this app always uses; an explicit one is
       always respected, including when it is the default. */
    if (!url.port && url.protocol === 'http:') url.port = DEFAULT_PORT;
    return `${url.protocol}//${url.host}`;
  }

  /* The pairing link carries both halves, which is why it is the fast path. */
  function readPairingLink(raw) {
    let url;
    try { url = new URL(String(raw == null ? '' : raw).trim()); } catch (e) { return null; }
    if (!/^https?:$/.test(url.protocol)) return null;
    const token = url.searchParams.get('t');
    if (!token) return null;
    const host = normalizeHost(url.origin);
    return host ? { host, token } : null;
  }

  return { DEFAULT_PORT, normalizeHost, readPairingLink };
}));
