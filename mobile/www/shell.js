'use strict';
/* The part of the phone app that is not the desktop UI.

   Its whole job is to answer two questions - which computer, and what is the
   password - and then get out of the way by handing over to the same page the
   desktop serves, which is bundled beside this one. Everything after that is
   shared code; this file exists because a webview has no address bar to type an
   address into and no way to be handed a link.

   State lives in localStorage because the bundled page reads it from there:
   same origin, so it is the one channel both halves already share. */
(() => {
  const HOST_KEY = 'casterHost';
  const TOKEN_KEY = 'casterToken';
  const APP = 'app/index.html';
  const PROBE_TIMEOUT_MS = 6000;

  const $ = id => document.getElementById(id);
  const store = {
    get(key) { try { return localStorage.getItem(key) || null; } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode */ } },
    drop(key) { try { localStorage.removeItem(key); } catch (e) { /* private mode */ } },
  };

  function say(text, kind) {
    const box = $('msg');
    box.textContent = text || '';
    box.className = 'msg' + (text ? ' show ' + (kind || '') : '');
  }

  /* host.js, so the fiddly parsing is covered by the test suite rather than
     only by somebody standing in a kitchen typing an address in. */
  const { normalizeHost, readPairingLink } = self.CasterHost;

  async function ask(host, path, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(host + path, { ...(options || {}), signal: controller.signal });
      let body = {};
      try { body = await response.json(); } catch (e) { /* not json */ }
      return { status: response.status, body };
    } finally { clearTimeout(timer); }
  }

  /* A stored pairing is only good if the computer still agrees, so this asks
     before handing over rather than dropping someone into a UI that will fail
     every request. 401 means the token was rotated; anything else means the
     computer is asleep or elsewhere, which is a different sentence. */
  async function verify(host, token) {
    try {
      const { status } = await ask(host, '/api/status', { headers: { 'X-Caster-Token': token } });
      if (status === 200) return { ok: true };
      if (status === 401) return { ok: false, reason: 'unpaired' };
      if (status === 403) return { ok: false, reason: 'closed' };
      return { ok: false, reason: 'error' };
    } catch (e) {
      return { ok: false, reason: e.name === 'AbortError' ? 'timeout' : 'unreachable' };
    }
  }

  function handOver() { location.replace(APP); }

  function showSetup(text, kind) {
    $('connecting').classList.add('hide');
    $('setup').classList.remove('hide');
    if (text) say(text, kind);
  }

  function save(host, token) {
    store.set(HOST_KEY, host);
    store.set(TOKEN_KEY, token);
  }

  async function connectWithLink() {
    const raw = $('link').value.trim();
    if (!raw) return say('Paste the link from the computer first.', 'err');
    const pair = readPairingLink(raw);
    if (!pair) {
      return say('That does not look like a pairing link. Use Copy link on the computer - '
        + 'the link has a code on the end of it.', 'err');
    }
    const { host, token } = pair;

    say('Checking…');
    const result = await verify(host, token);
    if (result.ok) { save(host, token); return handOver(); }
    say(explain(result.reason, host), 'err');
  }

  async function connectWithCode() {
    const host = normalizeHost($('host').value);
    const code = $('code').value.trim().toUpperCase();
    if (!host) return say('Enter the computer address, like 192.168.1.5:8765', 'err');
    if (!code) return say('Enter the pairing code shown on the computer.', 'err');

    say('Pairing…');
    let claimed;
    try {
      claimed = await ask(host, '/api/pair/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
    } catch (e) {
      return say(explain(e.name === 'AbortError' ? 'timeout' : 'unreachable', host), 'err');
    }
    if (claimed.status === 403) return say(explain('closed', host), 'err');
    if (claimed.status !== 200 || !claimed.body.token) {
      return say('That code was not accepted. Codes last three minutes - press '
        + 'Show a pairing code on the computer for a fresh one.', 'err');
    }
    save(host, claimed.body.token);
    handOver();
  }

  function explain(reason, host) {
    if (reason === 'unpaired') {
      return 'This phone is no longer paired. Get a new code or link from the computer.';
    }
    if (reason === 'closed') {
      return 'That computer is not accepting phones. Turn on "Let phones on this network '
        + 'control it" in its settings.';
    }
    if (reason === 'timeout' || reason === 'unreachable') {
      return `Could not reach ${host}. Check the computer is awake and on this same wifi, `
        + 'and that the address is right.';
    }
    return `${host} answered, but not in a way this app understood.`;
  }

  async function boot() {
    const host = store.get(HOST_KEY);
    const token = store.get(TOKEN_KEY);
    if (!host || !token) return showSetup();

    $('connectingwhere').textContent = host;
    const result = await verify(host, token);
    if (result.ok) return handOver();
    if (result.reason === 'unpaired') store.drop(TOKEN_KEY);
    showSetup(explain(result.reason, host), 'err');
    $('host').value = host.replace(/^https?:\/\//, '');
  }

  $('uselink').addEventListener('click', () => { connectWithLink().catch(e => say(e.message, 'err')); });
  $('usecode').addEventListener('click', () => { connectWithCode().catch(e => say(e.message, 'err')); });
  $('forget').addEventListener('click', () => {
    store.drop(HOST_KEY); store.drop(TOKEN_KEY);
    showSetup('Enter the computer to use.');
  });
  $('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('usecode').click(); });
  $('link').addEventListener('keydown', e => { if (e.key === 'Enter') $('uselink').click(); });

  boot().catch(e => showSetup(e.message, 'err'));
})();
