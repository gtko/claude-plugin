#!/usr/bin/env node
// Rend un gabarit HTML du skill release-showcase en PNG, avec Chrome installé et playwright-core.
//
// Usage :
//   node render.cjs <gabarit.html> <sortie.png> [largeur=1280] [hauteur=640] [scale=2] [--data <json|@fichier.json>]
//
//   largeur, hauteur : taille CSS du rendu (doit correspondre au gabarit : banner 1280x640, card 1200x675)
//   scale            : facteur de pixels (2 = rendu net en retina ; le PNG fait alors largeur*2 x hauteur*2)
//   --data           : paramètres du gabarit, en objet JSON ou @fichier.json. Les valeurs de clés image*, bg*,
//                      logo*, icon* qui désignent un fichier local existant sont converties en URL file://.
//
// Environnement facultatif :
//   CHROME_PATH      exécutable Chrome, Chromium, Edge ou Brave (sinon détecté dans /Applications et /usr/bin)
//   PLAYWRIGHT_CORE  chemin du paquet playwright-core (sinon résolu : require, `npm root -g`, cache npx,
//                    puis installé une fois via `npx -y -p playwright-core`)
//
// Aucun navigateur n'est téléchargé : le rendu utilise le Chrome déjà installé.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync, spawnSync } = require('child_process');

const USAGE = 'Usage : node render.cjs <gabarit.html> <sortie.png> [largeur=1280] [hauteur=640] [scale=2] [--data <json|@fichier.json>]';

function parseArgs(argv) {
  const pos = [];
  let data = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
    if (a === '--data') {
      if (argv[i + 1] === undefined) throw new Error('--data attend une valeur (JSON ou @fichier.json)');
      data = argv[++i];
    } else pos.push(a);
  }
  if (pos.length < 2) { console.error(USAGE); process.exit(2); }
  const num = (v, def) => {
    const n = Number(v === undefined ? def : v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`valeur numérique invalide : ${v}`);
    return n;
  };
  return {
    html: pos[0],
    png: pos[1],
    width: num(pos[2], 1280),
    height: num(pos[3], 640),
    scale: num(pos[4], 2),
    data,
  };
}

// Recherche le paquet playwright-core sans dépendre du dossier courant.
function candidatePackageDirs() {
  const dirs = [];
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    dirs.push(path.join(globalRoot, 'playwright-core'));
  } catch (e) { /* npm absent : on continue */ }
  const npxRoot = path.join(os.homedir(), '.npm', '_npx');
  if (fs.existsSync(npxRoot)) {
    const entries = fs.readdirSync(npxRoot)
      .map((d) => path.join(npxRoot, d, 'node_modules', 'playwright-core'))
      .filter((d) => fs.existsSync(path.join(d, 'package.json')))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs); // le plus récent d'abord
    dirs.push(...entries);
  }
  return dirs.filter((d) => fs.existsSync(path.join(d, 'package.json')));
}

function tryRequire(id) {
  try { return require(id); } catch (e) { return null; }
}

function loadPlaywright() {
  if (process.env.PLAYWRIGHT_CORE) {
    const m = tryRequire(process.env.PLAYWRIGHT_CORE);
    if (m) return m;
    throw new Error(`PLAYWRIGHT_CORE ne charge pas : ${process.env.PLAYWRIGHT_CORE}`);
  }
  const direct = tryRequire('playwright-core');
  if (direct) return direct;
  const found = () => candidatePackageDirs().map(tryRequire).find(Boolean);
  let m = found();
  if (m) return m;
  // Dernier recours : npx installe playwright-core dans son cache, puis on le retrouve.
  process.stderr.write('playwright-core introuvable : installation via npx (une seule fois)…\n');
  spawnSync('npx', ['-y', '-p', 'playwright-core', 'node', '-e', '0'], { stdio: ['ignore', 'ignore', 'inherit'] });
  m = found();
  if (m) return m;
  throw new Error('playwright-core introuvable. Installer : npm i -g playwright-core, ou PLAYWRIGHT_CORE=<dossier du paquet>.');
}

const BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
];

function findChrome() {
  if (process.env.CHROME_PATH) {
    if (!fs.existsSync(process.env.CHROME_PATH)) throw new Error(`CHROME_PATH introuvable : ${process.env.CHROME_PATH}`);
    return process.env.CHROME_PATH;
  }
  const found = BROWSERS.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome introuvable. Définir CHROME_PATH=/chemin/vers/chrome.');
  return found;
}

// Les chemins de fichiers locaux deviennent des URL file:// absolues (le gabarit vit dans un autre dossier).
const FILE_KEY = /^(image|bg|logo|icon)/i;
function prepareData(raw) {
  if (raw === null) return {};
  const text = raw.startsWith('@') ? fs.readFileSync(raw.slice(1), 'utf8') : raw;
  const obj = JSON.parse(text);
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('--data doit être un objet JSON');
  for (const [key, value] of Object.entries(obj)) {
    if (!FILE_KEY.test(key) || typeof value !== 'string') continue;
    if (/^(data:|https?:|file:)/.test(value)) continue;
    const abs = path.resolve(value);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) obj[key] = pathToFileURL(abs).href;
  }
  return obj;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const htmlPath = path.resolve(opts.html);
  if (!fs.existsSync(htmlPath)) throw new Error(`gabarit introuvable : ${htmlPath}`);
  const data = prepareData(opts.data);
  const query = Object.keys(data).length ? `?json=${encodeURIComponent(JSON.stringify(data))}` : '';
  const url = pathToFileURL(htmlPath).href + query;

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--font-render-hinting=none'],
  });
  let pngPath;
  try {
    const page = await browser.newPage({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: opts.scale,
    });
    const jsErrors = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    await page.goto(url, { waitUntil: 'load' });
    // Le gabarit pose data-ready="1" une fois ses images décodées.
    await page.waitForFunction(() => document.body && document.body.dataset.ready === '1', null, { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    if (jsErrors.length) throw new Error(`erreur JavaScript dans le gabarit : ${jsErrors.join(' | ')}`);

    pngPath = path.resolve(opts.png);
    fs.mkdirSync(path.dirname(pngPath), { recursive: true });
    await page.screenshot({
      path: pngPath,
      type: 'png',
      clip: { x: 0, y: 0, width: opts.width, height: opts.height },
    });
  } finally {
    await browser.close();
  }
  console.log(`${pngPath} ${opts.width * opts.scale}x${opts.height * opts.scale}`);
}

main().catch((e) => {
  console.error(`render.cjs: ${e.message}`);
  process.exit(1);
});
