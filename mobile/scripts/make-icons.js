'use strict';
/* Every piece of artwork the phone app ships, drawn rather than committed.

   Capacitor generates its own logo into both native projects, so without this
   the app would go out wearing Capacitor's branding rather than this one's.
   Generating also keeps 29 binaries out of git - which matters more here than
   it looks, because this repo tracks *.png in LFS and CI checks out with
   lfs:false to save bandwidth on the screenshots. Committed art therefore
   arrives on the runner as text pointers: actool fails with "Distill failed for
   unknown reasons", and Android does not fail at all - it just packages the
   pointer files and ships an app with no icon. The repo already hit this once
   with the menu-bar templates; .gitattributes still carries the scar.

   The glyph and the PNG encoder come from the desktop's generator, so there is
   one drawing of the speaker in this repository. */
const fs = require('fs');
const path = require('path');
const { canvas, glyph, roundedRect, png } = require('../../scripts/make-icon.js');

const ACCENT = [47, 109, 246];
const WHITE = [255, 255, 255, 255];
const ROOT = path.join(__dirname, '..');
const ANDROID_RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const IOS_ASSETS = path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets');

let written = 0;
function put(file, buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  written += 1;
}

/* The glyph helper fills whatever canvas it is given, so anything that is not a
   full-bleed square is drawn on its own square first and then copied in. */
function stamp(dst, size, x0, y0) {
  const src = canvas(size, size);
  glyph(src, size, WHITE, 0.3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    if (src.px[i + 3]) dst.set(x0 + x, y0 + y, src.px[i], src.px[i + 1], src.px[i + 2], src.px[i + 3]);
  }
}

function circle(c, s, col) {
  const [r, g, b, a] = col, mid = (s - 1) / 2;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    if (Math.hypot(x - mid, y - mid) <= mid) c.set(x, y, r, g, b, a);
  }
}

/* A rectangle of accent with the speaker in the middle, for launch screens. */
function splash(w, h) {
  const c = canvas(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) c.set(x, y, ...ACCENT, 255);
  const g = Math.round(Math.min(w, h) * 0.28);
  stamp(c, g, Math.round((w - g) / 2), Math.round((h - g) / 2));
  return png(c, { alpha: false, over: ACCENT });
}

// ---- Android ----
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

for (const [density, scale] of Object.entries(DENSITIES)) {
  const dir = path.join(ANDROID_RES, `mipmap-${density}`);
  const s = Math.round(48 * scale);

  const square = canvas(s, s);
  roundedRect(square, s, Math.round(s * 0.22), [...ACCENT, 255]);
  glyph(square, s, WHITE, 0.3);
  put(path.join(dir, 'ic_launcher.png'), png(square));

  const round = canvas(s, s);
  circle(round, s, [...ACCENT, 255]);
  glyph(round, s, WHITE, 0.3);
  put(path.join(dir, 'ic_launcher_round.png'), png(round));

  /* Adaptive icons are 108dp with only the middle 72dp guaranteed visible -
     the launcher masks and animates the rest - so the glyph is drawn at 60% and
     centred, on transparency. The background is a colour, not a picture. */
  const fg = Math.round(108 * scale);
  const foreground = canvas(fg, fg);
  const inner = Math.round(fg * 0.6);
  stamp(foreground, inner, Math.round((fg - inner) / 2), Math.round((fg - inner) / 2));
  put(path.join(dir, 'ic_launcher_foreground.png'), png(foreground));
}

/* Capacitor's generated project references every one of these, and a missing
   drawable is a build failure rather than a fallback. */
const SPLASHES = { mdpi: [480, 320], hdpi: [800, 480], xhdpi: [1280, 720],
  xxhdpi: [1600, 960], xxxhdpi: [1920, 1280] };
put(path.join(ANDROID_RES, 'drawable', 'splash.png'), splash(480, 320));
for (const [density, [long, short]] of Object.entries(SPLASHES)) {
  put(path.join(ANDROID_RES, `drawable-land-${density}`, 'splash.png'), splash(long, short));
  put(path.join(ANDROID_RES, `drawable-port-${density}`, 'splash.png'), splash(short, long));
}

// ---- iOS ----
if (fs.existsSync(IOS_ASSETS)) {
  /* One 1024 image; Xcode derives the rest. Full bleed and opaque: iOS applies
     its own mask, and actool refuses an app icon with an alpha channel. */
  const icon = canvas(1024, 1024);
  roundedRect(icon, 1024, 0, [...ACCENT, 255]);
  glyph(icon, 1024, WHITE, 0.3);
  const iconSet = path.join(IOS_ASSETS, 'AppIcon.appiconset');
  put(path.join(iconSet, 'AppIcon-512@2x.png'), png(icon, { alpha: false, over: ACCENT }));
  put(path.join(iconSet, 'Contents.json'), Buffer.from(JSON.stringify({
    images: [{ filename: 'AppIcon-512@2x.png', idiom: 'universal',
      platform: 'ios', size: '1024x1024' }],
    info: { author: 'xcode', version: 1 },
  }, null, 2) + '\n'));

  /* The three scales Capacitor's Contents.json names. They are the same square
     at the same size - the launch screen is scaled to fill either way. */
  const launch = splash(2732, 2732);
  const set = path.join(IOS_ASSETS, 'Splash.imageset');
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    put(path.join(set, name), launch);
  }
}

console.log(`  ${written} images drawn`);
