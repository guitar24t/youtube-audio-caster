'use strict';
/* The phone bundles the same page the desktop serves, rather than loading it
   over the network. Two reasons: a binary whose only content is a remote page
   is a "web clipping" to App Review, and a bundled page opens instantly and can
   say "I cannot reach your computer" instead of showing a browser error.

   Copied at build time rather than checked in, so renderer/ stays the single
   source of truth. The copy is gitignored - a second copy in the tree is a
   second thing to forget. */
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..', '..');
const from = path.join(repo, 'renderer');
const to = path.join(__dirname, '..', 'www', 'app');

const FILES = ['index.html'];

fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(to, { recursive: true });

for (const name of FILES) {
  const src = path.join(from, name);
  if (!fs.existsSync(src)) {
    console.error(`sync-www: ${name} is missing from ${from}`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(to, name));
  console.log(`  ${name}  ${(fs.statSync(src).size / 1024).toFixed(1)}kB`);
}

/* Stamped so a phone can tell the user it is older than the computer it is
   talking to, rather than failing in some way nobody can interpret. */
const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(to, 'bundled.json'), JSON.stringify({ version }, null, 1) + '\n');
console.log(`  bundled from version ${version}`);
