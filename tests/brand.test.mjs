// Dua Audit Hub branding: one name everywhere, generated icons not stale, themed (monochrome) icons present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { textOutputs, pngPlan, BRAND, LABELS } from '../scripts/build-brand.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

test('generated text outputs are up to date (run `npm run brand`)', () => {
  for (const [rel, content] of Object.entries(textOutputs())) assert.equal(read(rel), content, `${rel} is stale`);
});

test('every planned PNG exists and is a real PNG', () => {
  for (const [rel] of pngPlan()) {
    assert.ok(exists(rel), `${rel} missing (npm run brand:png)`);
    assert.equal(fs.readFileSync(path.join(ROOT, rel)).subarray(1, 4).toString(), 'PNG', `${rel} is not a PNG`);
  }
  assert.ok(exists('favicon.ico'));
});

test('one product name across PWA, Android app, offline page and widget', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.name, LABELS.web);
  assert.equal(manifest.short_name, LABELS.web);
  assert.match(read('index.html'), /<title>Dua Audit Hub/);
  assert.match(read('index.html'), /<div class="header-title">Dua Audit Hub<\/div>/);
  const strings = read('AndroidApp/android/app/src/main/res/values/strings.xml');
  assert.match(strings, /<string name="app_name">Dua Audit Hub<\/string>/);
  assert.match(strings, /<string name="title_activity_main">Dua Audit Hub<\/string>/);
  assert.match(read('AndroidApp/capacitor.config.json'), /"appName": "Dua Audit Hub"/);
  assert.match(read('AndroidApp/www/index.html'), /Can't reach Dua Audit Hub/);
  assert.match(read('AuditWidget/app/src/main/res/values/strings.xml'), new RegExp(`<string name="app_name">${LABELS.widget}</string>`));
  for (const rel of ['manifest.json', 'index.html', 'AndroidApp/www/index.html', 'AndroidApp/android/app/src/main/res/values/strings.xml', 'AuditWidget/app/src/main/res/values/strings.xml']) {
    assert.doesNotMatch(read(rel), /PharmaAudit|Pharmacy Audit Hub|Audit Rounds Widget/, `${rel} still carries an old name`);
  }
});

test('themed icons: monochrome layer on both Android apps and in the PWA manifest', () => {
  for (const res of ['AndroidApp/android/app/src/main/res', 'AuditWidget/app/src/main/res']) {
    for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      assert.match(read(`${res}/mipmap-anydpi-v26/${f}`), /<monochrome android:drawable="@drawable\/ic_launcher_monochrome"/);
    }
    const mono = read(`${res}/drawable/ic_launcher_monochrome.xml`);
    const colours = new Set([...mono.matchAll(/(?:fillColor|strokeColor)="(#[0-9A-Fa-f]+)"/g)].map((m) => m[1].toUpperCase()));
    assert.deepEqual([...colours], ['#FFFFFF'], `${res} monochrome layer must be one colour`);
  }
  const manifest = JSON.parse(read('manifest.json'));
  const mono = manifest.icons.find((i) => i.purpose === 'monochrome');
  assert.ok(mono && exists(mono.src), 'manifest needs a monochrome icon that exists');
  for (const i of manifest.icons) assert.ok(exists(i.src), `${i.src} missing`);
});

test('launcher background is the brand crimson in both Android apps', () => {
  assert.match(read('AndroidApp/android/app/src/main/res/values/ic_launcher_background.xml'), new RegExp(BRAND.crimson, 'i'));
  assert.match(read('AuditWidget/app/src/main/res/drawable/ic_launcher_background.xml'), new RegExp(BRAND.crimson, 'i'));
});

test('manifest shortcuts use ?view= links that the app can open', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const allowed = /const LAUNCH_VIEWS = new Set\(\[([^\]]+)\]\)/.exec(read('js/pages/auth-pages.js'))[1];
  assert.ok(manifest.shortcuts.length >= 2 && manifest.shortcuts.length <= 4);
  for (const s of manifest.shortcuts) {
    const view = new URL(s.url, 'https://x.test/').searchParams.get('view');
    assert.ok(view, `${s.name} shortcut has no ?view=`);
    assert.ok(allowed.includes(`'${view}'`), `${s.name}: view "${view}" is not in LAUNCH_VIEWS`);
    assert.ok(read('index.html').includes(`data-view="${view}"`), `no page for view "${view}"`);
  }
});

test('Barcode Center has its own tile colour and the home tiles use SVG, not emoji', () => {
  const html = read('index.html');
  assert.match(html, /section-tile--barcode" data-action="navigate" data-view="barcode"/);
  assert.match(read('css/app.css'), /\.section-tile--barcode\s*\{/);
  const tiles = [...html.matchAll(/<div class="section-tile-icon">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
  assert.ok(tiles.length >= 4);
  for (const t of tiles) assert.match(t, /^<svg /, 'home tile icon should be an inline SVG');
});

test('service worker precaches the wordmark and the cache name was bumped for this release', () => {
  const sw = read('sw.js');
  assert.match(sw, /duapharma-wordmark-light\.svg/);
  assert.doesNotMatch(sw, /v9\.09-render-race-fix/);
});
