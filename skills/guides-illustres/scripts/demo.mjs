// Démo du kit de capture : sert une page locale, joue un scénario en headless, produit les sorties dans demo-out/
// et contrôle chaque fichier produit (dimensions, poids, durée, absence d'audio, temps morts retirés).
// Usage : PLAYWRIGHT_PATH=<chemin ou URL de playwright/index.mjs> node demo.mjs (variable obligatoire, aucun défaut)
// Code de sortie 0 si tout est conforme, 1 sinon. Les sorties restent dans demo-out/ (à supprimer à la main).
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  VIEWPORT, CURSOR_SCRIPT, sleep, now, createSession, click, typeIn, scrollTo, waitNetQuiet,
  waitScrollSettled, parkCursor, unfilmed, snap, guardNetwork, toWebp, variant, ogImage,
  cutClip, keptSegments, clipTime, posterFrom, probeMedia,
} from './capture-kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'demo-out');
const MAX_IMG_BYTES = 250_000;
const MAX_CLIP_SEC = 20;
// Hôte fictif (domaine .invalid) : jamais résolu, donc aucun trafic réel même si le garde réseau laissait passer.
const TRACKER_HOST = 'tracker.invalid';

// Page fictive : une présentation haute (défilement nécessaire), puis un formulaire et un bouton.
const PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Démo capture-kit</title>
<style>
  :root { --bleu: #2a3b6e; --fond: #f4f6fb; --texte: #1d2330; --bord: #c5ccdc; }
  body { margin: 0; font-family: system-ui, "Segoe UI", sans-serif; background: var(--fond); color: var(--texte); }
  header { padding: 24px 48px; background: var(--bleu); color: #fff; font-weight: 600; font-size: 18px; }
  .intro { padding: 48px; min-height: 1100px; box-sizing: border-box; }
  .intro p { max-width: 640px; line-height: 1.6; }
  .carte { max-width: 460px; margin: 0 auto 80px; background: #fff; border-radius: 12px; padding: 28px; box-shadow: 0 4px 18px rgba(20, 30, 60, .12); }
  h2 { margin: 0 0 16px; }
  label { display: block; font-weight: 600; margin: 14px 0 6px; }
  input { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 16px; border: 1px solid var(--bord); border-radius: 8px; }
  button { margin-top: 20px; padding: 12px 20px; font-size: 16px; color: #fff; background: var(--bleu); border: 0; border-radius: 8px; cursor: pointer; }
  #msg { margin-top: 16px; min-height: 24px; color: #1b7a3d; font-weight: 600; }
  #ping { margin-top: 24px; color: #5a6276; font-size: 14px; }
</style>
</head>
<body>
<header>Démo capture-kit</header>
<section class="intro">
  <h1>Présentation</h1>
  <p>Cette page fictive sert à démontrer le kit de capture : défilement, saisie lente, clic, attente serveur et captures.</p>
  <p>Le formulaire se trouve plus bas, pour obliger le scénario à défiler avant de saisir.</p>
</section>
<section id="formulaire">
  <div class="carte">
    <h2>Inscription à la lettre</h2>
    <form id="inscription" autocomplete="off">
      <label for="nom">Nom</label>
      <input id="nom" name="nom" type="text">
      <label for="email">Courriel</label>
      <input id="email" name="email" type="email">
      <button id="enregistrer" type="submit">Enregistrer</button>
      <div id="msg" role="status"></div>
    </form>
    <p id="ping">Statut du service : en attente</p>
    <img src="https://${TRACKER_HOST}/p.gif" width="1" height="1" alt="">
  </div>
</section>
<script>
  var form = document.getElementById('inscription');
  var msg = document.getElementById('msg');
  fetch('https://api.demo.invalid/v1/ping')
    .then(function (r) { return r.json(); })
    .then(function (j) { document.getElementById('ping').textContent = 'Statut du service : ' + j.status; })
    .catch(function () {});
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var body = { nom: form.elements.nom.value, email: form.elements.email.value };
    msg.textContent = 'Envoi…';
    fetch('/api/inscription', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j.ok) msg.textContent = 'Merci ' + body.nom + ', votre inscription est enregistrée.'; });
  });
</script>
</body>
</html>
`;

/** Importe Playwright depuis PLAYWRIGHT_PATH (chemin ou URL file:) : le kit ne dépend pas de Playwright. */
async function loadChromium() {
  const raw = process.env.PLAYWRIGHT_PATH;
  if (!raw) throw new Error("PLAYWRIGHT_PATH non défini : indique node_modules/playwright/index.mjs d'un projet");
  if (!raw.startsWith('file:') && !existsSync(resolve(raw))) {
    throw new Error(`Playwright introuvable (${raw}) : définis PLAYWRIGHT_PATH vers node_modules/playwright/index.mjs d'un projet`);
  }
  const href = raw.startsWith('file:') ? raw : pathToFileURL(resolve(raw)).href;
  const mod = await import(href);
  if (typeof mod.chromium?.launch !== 'function') throw new Error(`${raw} n'exporte pas chromium`);
  return mod.chromium;
}

/** Réponses simulées pour le garde réseau : seul l'hôte d'API fictif est servi, le reste suit les règles du kit. */
function demoMock(url) {
  if (url.hostname === 'api.demo.invalid' && url.pathname === '/v1/ping') {
    return { body: { status: 'opérationnel (réponse simulée)' } };
  }
  return null;
}

/** Serveur HTTP natif sur un port libre (127.0.0.1). POST /api/inscription attend 1,2 s (temps mort du scénario). */
function startServer() {
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(PAGE);
      }
      if (req.method === 'POST' && req.url === '/api/inscription') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw || '{}');
        await sleep(1200);
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, nom: body.nom ?? '' }));
      }
      res.writeHead(404).end();
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  return new Promise((resolveP, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveP(server));
  });
}

/** Contrôle des fichiers produits : présence, dimensions, poids, durée, audio. Renvoie les lignes et les écarts. */
function checkOutputs(expected) {
  const rows = [];
  const problems = [];
  for (const e of expected) {
    const p = join(OUT, e.file);
    if (!existsSync(p)) {
      problems.push(`${e.file} absent`);
      continue;
    }
    const bytes = statSync(p).size;
    const m = probeMedia(p);
    const dur = e.maxSec && m.duration != null ? `  ${m.duration.toFixed(2)} s` : '';
    rows.push(`  ${e.file.padEnd(28)} ${String(m.width)}x${String(m.height)}  ${Math.round(bytes / 1024)} Ko${dur}`);
    if (m.width !== e.w || m.height !== e.h) problems.push(`${e.file} : ${m.width}x${m.height}, attendu ${e.w}x${e.h}`);
    if (e.maxBytes && bytes > e.maxBytes) problems.push(`${e.file} : ${bytes} o, plafond ${e.maxBytes} o`);
    if (e.maxSec && (m.duration ?? Infinity) > e.maxSec) problems.push(`${e.file} : ${m.duration} s, plafond ${e.maxSec} s`);
    if (e.noAudio && m.hasAudio) problems.push(`${e.file} : piste audio présente`);
  }
  return { rows, problems };
}

async function main() {
  const started = Date.now();
  // Durée par étape, affichée en fin de run (repérer ce qui pèse).
  const timings = [];
  let lastT = started;
  const phase = (label) => {
    const n = Date.now();
    timings.push(`${label} ${((n - lastT) / 1000).toFixed(1)} s`);
    lastT = n;
  };
  const chromium = await loadChromium();
  const work = mkdtempSync(join(tmpdir(), 'capture-kit-demo-'));
  const shotsDir = join(work, 'shots');
  const videoDir = join(work, 'video');
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      locale: 'fr-FR',
      recordVideo: { dir: videoDir, size: VIEWPORT },
    });
    const blocked = await guardNetwork(context, { mock: demoMock });
    await context.addInitScript(CURSOR_SCRIPT);
    const page = await context.newPage();
    const s = createSession(page);
    const video = s.video;
    if (!video) throw new Error('vidéo absente : recordVideo non actif');

    await page.goto(`${base}/`, { waitUntil: 'load' });
    await page.locator('#inscription').waitFor({ state: 'visible', timeout: 15_000 });
    await waitNetQuiet(s);
    phase('chargement');

    // Scénario : défilement, deux saisies lentes, capture ; clic, attente serveur (non filmée), capture.
    s.clip.start = now(s);
    await sleep(400);
    await scrollTo(s, page.locator('#formulaire'), 400);
    await waitScrollSettled(page);
    await typeIn(s, page.locator('#nom'), 'Ada Lovelace', { delay: 70, pause: 250 });
    await typeIn(s, page.locator('#email'), 'ada@exemple.test', { delay: 70, pause: 250 });
    await parkCursor(s);
    await snap(s, '01-formulaire', shotsDir);
    await click(s, page.locator('#enregistrer'), 0);
    await unfilmed(s, () => page.locator('#msg', { hasText: 'Merci' }).waitFor({ state: 'visible', timeout: 15_000 }));
    await sleep(900); // confirmation lisible à la fin du clip
    await parkCursor(s);
    await snap(s, '02-confirmation', shotsDir);
    s.clip.end = now(s);
    phase('scénario');

    await context.close(); // finalise la vidéo brute
    const videoFile = await video.path();
    phase('vidéo');

    // Montage : intervalles gardés, clip, images, affiche, image de partage.
    const from = Math.max(0, s.clip.start - 0.1);
    const to = s.clip.end + 0.2;
    const segs = keptSegments(from, to, s.cuts);
    const clipDur = segs.reduce((acc, [a, b]) => acc + (b - a), 0);
    if (clipDur > MAX_CLIP_SEC) throw new Error(`clip de ${clipDur.toFixed(1)} s : plus de ${MAX_CLIP_SEC} s`);
    const clipFile = join(OUT, 'clip.mp4');
    cutClip(videoFile, clipFile, segs);
    phase('montage');

    for (const sh of s.shots) {
      const info = toWebp(sh.png, join(OUT, `${sh.name}.webp`), { maxBytes: MAX_IMG_BYTES });
      if (!info.withinLimit) throw new Error(`${sh.name}.webp : ${info.kb} Ko même en q${info.q}, plus de ${MAX_IMG_BYTES / 1000} Ko`);
      variant(sh.png, join(OUT, `${sh.name}-1280.webp`), 1280, 80);
    }
    posterFrom(clipFile, join(OUT, 'poster.webp'), { at: clipTime(segs, s.marks['01-formulaire']) });
    ogImage(join(OUT, `${s.shots[0].name}.webp`), join(OUT, 'og.jpg'));
    phase('images');

    // Contrôles.
    const { rows, problems } = checkOutputs([
      { file: '01-formulaire.webp', w: 2560, h: 1600, maxBytes: MAX_IMG_BYTES },
      { file: '02-confirmation.webp', w: 2560, h: 1600, maxBytes: MAX_IMG_BYTES },
      { file: '01-formulaire-1280.webp', w: 1280, h: 800 },
      { file: '02-confirmation-1280.webp', w: 1280, h: 800 },
      { file: 'poster.webp', w: 1280, h: 800 },
      { file: 'og.jpg', w: 1200, h: 630 },
      { file: 'clip.mp4', w: 1280, h: 800, maxSec: MAX_CLIP_SEC, noAudio: true },
    ]);
    const clipMeta = probeMedia(clipFile);
    const filmed = to - from;
    const cutTotal = filmed - clipDur;
    if (Math.abs((clipMeta.duration ?? -99) - clipDur) > 0.6) problems.push(`clip.mp4 : ${clipMeta.duration} s, attendu ${clipDur.toFixed(2)} s`);
    if (cutTotal < 1.0) problems.push(`temps morts retirés : ${cutTotal.toFixed(2)} s, attendu au moins 1 s (attente serveur)`);
    if (!blocked.has(TRACKER_HOST)) problems.push(`${TRACKER_HOST} : non listé comme bloqué`);
    if (s.errors.length) problems.push(`erreurs de page : ${s.errors[0].slice(0, 160)}`);

    console.log(`Scénario : ${clipDur.toFixed(1)} s gardées sur ${filmed.toFixed(1)} s filmées (${cutTotal.toFixed(1)} s de temps morts retirés)`);
    console.log(`Hôtes bloqués : ${[...blocked].join(', ') || 'aucun'}`);
    console.log(`Sorties dans ${OUT} :`);
    for (const r of rows) console.log(r);
    phase('contrôles');
    console.log(`Durées : ${timings.join(' · ')}`);
    if (problems.length) throw new Error(`contrôles échoués :\n  - ${problems.join('\n  - ')}`);
    console.log(`DEMO OK en ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
    server.closeAllConnections?.();
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

main().then(
  () => { process.exitCode = 0; },
  (err) => {
    console.error(`DEMO ÉCHEC : ${err.message}`);
    process.exitCode = 1;
  },
);
