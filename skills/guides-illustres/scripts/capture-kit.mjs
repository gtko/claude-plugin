// Kit de capture headless pour les guides illustrés : curseur factice, attentes réseau, garde réseau,
// images WebP/JPEG, affiche et clip MP4 monté (attentes retirées).
// Dépendances : aucune côté Node. Playwright est fourni par l'appelant (jamais importé ici) ; ffmpeg doit être dans le PATH.
// Node ≥ 20, ESM. Aucun texte spécifique à une application : tout ce qui est propre au site vit dans le scénario.
import { mkdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, join } from 'node:path';

/** Fenêtre des captures (px CSS). Les PNG font le double avec deviceScaleFactor 2. */
export const VIEWPORT = { width: 1280, height: 800 };
/** Encodage H.264 du clip : yuv420p, faststart, sans audio. */
export const ENC = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an'];

/** Qualités WebP essayées dans l'ordre jusqu'à passer sous le plafond. */
const WEBP_QUALITIES = [82, 74, 66, 58];
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.mkv']);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Secondes écoulées depuis le début de la session : repère commun des intervalles `s.cuts`. */
export const now = (s) => (Date.now() - s.t0) / 1000;

/** Vrai pour localhost, *.localhost, 127.0.0.1 et ::1. */
export function isLocalHost(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '::1';
}

/** Script à injecter (context.addInitScript) : curseur factice et onde au clic. Masqué pendant les captures PNG. */
export const CURSOR_SCRIPT = `(() => {
  if (window.__capCursorInstalled) return;
  window.__capCursorInstalled = true;
  let x = -100, y = -100;
  const layer = () => {
    let l = document.getElementById('__cap_layer');
    if (!l && document.documentElement) {
      l = document.createElement('div');
      l.id = '__cap_layer';
      l.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647';
      l.innerHTML = '<div id="__cap_cursor" style="position:fixed;left:0;top:0;width:22px;height:22px;transform:translate(-100px,-100px)"><span style="display:block;width:100%;height:100%;box-sizing:border-box;border-radius:50%;background:#fff;border:2px solid #111;box-shadow:0 2px 6px rgba(0,0,0,.45)"></span></div>';
      (document.body || document.documentElement).appendChild(l);
    }
    return l;
  };
  const place = () => {
    const c = document.getElementById('__cap_cursor');
    if (c) c.style.transform = 'translate(' + (x - 11) + 'px,' + (y - 11) + 'px)';
  };
  const ripple = (px, py) => {
    const l = layer();
    if (!l) return;
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;left:' + (px - 22) + 'px;top:' + (py - 22) + 'px;width:44px;height:44px;box-sizing:border-box;border-radius:50%;border:3px solid rgba(255,255,255,.95);box-shadow:0 0 0 1px rgba(0,0,0,.35);pointer-events:none';
    l.appendChild(r);
    r.animate([{ transform: 'scale(.4)', opacity: 1 }, { transform: 'scale(1.9)', opacity: 0 }], { duration: 520, easing: 'ease-out' }).onfinish = () => r.remove();
  };
  const pulse = () => {
    const d = document.querySelector('#__cap_cursor span');
    if (d) d.animate([{ transform: 'scale(1)' }, { transform: 'scale(.6)' }, { transform: 'scale(1)' }], { duration: 260 });
  };
  const onMove = (e) => { x = e.clientX; y = e.clientY; layer(); place(); };
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mousedown', (e) => { onMove(e); ripple(e.clientX, e.clientY); pulse(); }, true);
  document.addEventListener('DOMContentLoaded', () => { layer(); place(); }, true);
})();`;

/**
 * Crée la session de capture pour une page (à faire après context.newPage()).
 * Suit les requêtes en vol (`inflight`), les erreurs de page (`errors`) et la vidéo (`video`, null sans recordVideo).
 * @param {import('playwright').Page} page
 */
export function createSession(page) {
  const s = {
    page,
    inflight: 0,
    marks: {},
    clip: {},
    cuts: [],
    shots: [],
    cursor: { x: 60, y: 60 },
    t0: Date.now(),
    errors: [],
    video: page.video(),
  };
  page.on('pageerror', (e) => s.errors.push(e.message));
  page.on('request', () => { s.inflight += 1; });
  page.on('requestfinished', () => { s.inflight = Math.max(0, s.inflight - 1); });
  page.on('requestfailed', () => { s.inflight = Math.max(0, s.inflight - 1); });
  return s;
}

/** Déplacement lisible du curseur (easeInOutQuad, 8 à 18 étapes). */
export async function glideTo(s, x, y) {
  const dist = Math.hypot(x - s.cursor.x, y - s.cursor.y);
  // Chaque mouse.move est un aller-retour CDP : peu d'étapes, espacées.
  const steps = Math.max(8, Math.min(18, Math.round(dist / 45)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - (Math.pow(-2 * t + 2, 2)) / 2;
    await s.page.mouse.move(s.cursor.x + (x - s.cursor.x) * e, s.cursor.y + (y - s.cursor.y) * e);
    await sleep(8);
  }
  s.cursor.x = x;
  s.cursor.y = y;
}

/**
 * Clique sur un élément (Locator) avec le curseur factice visible, puis attend `pause` ms.
 * @param {number} [pause=600]
 */
export async function click(s, loc, pause = 600) {
  const el = loc.first();
  await el.waitFor({ state: 'visible', timeout: 20_000 });
  // Un élément hors fenêtre recevrait le clic à des coordonnées négatives.
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const b = await el.boundingBox();
  if (!b) throw new Error('click : élément sans boîte (masqué ou détaché du DOM)');
  await glideTo(s, b.x + b.width / 2, b.y + b.height / 2);
  await sleep(140);
  await s.page.mouse.down();
  await sleep(60);
  await s.page.mouse.up();
  if (pause) await sleep(pause);
}

/**
 * Clique sur un champ puis tape `text` lentement (frappe visible à l'écran).
 * @param {{delay?: number, pause?: number}} [opts] délai entre touches (ms, défaut 70), pause finale (ms, défaut 500)
 */
export async function typeIn(s, loc, text, { delay = 70, pause = 500 } = {}) {
  await click(s, loc, 250);
  await s.page.keyboard.type(text, { delay });
  if (pause) await sleep(pause);
}

/** Fait défiler jusqu'au centre de l'élément (défilement doux), puis attend `pause` ms. */
export async function scrollTo(s, loc, pause = 800) {
  await loc.first().evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await sleep(pause);
}

/** Attend que plus aucune requête ne soit en cours pendant `quietMs` (ou `maxMs` au plus). */
export async function waitNetQuiet(s, quietMs = 500, maxMs = 15_000) {
  const t0 = Date.now();
  let quietSince = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (s.inflight > 0) quietSince = Date.now();
    if (Date.now() - quietSince >= quietMs) return;
    await sleep(50);
  }
}

/** Attend que la position de défilement soit stable pendant ~0,5 s (40 échantillons au plus). */
export async function waitScrollSettled(page) {
  let last = null;
  let still = 0;
  for (let i = 0; i < 40 && still < 5; i++) {
    const y = await page.evaluate(() => window.scrollY);
    still = y === last ? still + 1 : 0;
    last = y;
    await sleep(100);
  }
}

/** Gare le pointeur dans un coin vide (pas de survol parasite dans les images). */
export async function parkCursor(s) {
  await s.page.mouse.move(2, 2);
  s.cursor.x = 2;
  s.cursor.y = 2;
  await sleep(150);
}

/**
 * Exécute `fn` hors enregistrement : sa durée est retirée du clip (attente serveur, chargement).
 * @returns {Promise<any>} la valeur de `fn`
 */
export async function unfilmed(s, fn) {
  const from = now(s);
  try {
    return await fn();
  } finally {
    s.cuts.push([from, now(s)]);
  }
}

async function setCaptureLayer(s, visible) {
  await s.page.evaluate((v) => {
    const l = document.getElementById('__cap_layer');
    if (l) l.style.display = v ? '' : 'none';
  }, visible);
}

/**
 * Capture PNG de la page, curseur factice masqué. Le temps de capture est retiré du clip.
 * La conversion (toWebp) se fait après l'enregistrement.
 * @param {string} name nom de la capture (sans extension), réutilisé pour `marks` et les fichiers
 * @param {string} tmpDir dossier des PNG (créé si besoin)
 * @returns {Promise<string>} chemin du PNG
 */
export async function snap(s, name, tmpDir) {
  mkdirSync(tmpDir, { recursive: true });
  const from = now(s);
  await setCaptureLayer(s, false);
  await sleep(120);
  const png = join(tmpDir, `${name}.png`);
  await s.page.screenshot({ path: png });
  await setCaptureLayer(s, true);
  s.cuts.push([from, now(s)]);
  s.marks[name] = now(s);
  s.shots.push({ name, png });
  return png;
}

/**
 * Garde réseau du contexte, à poser avant la navigation. Les hôtes locaux passent toujours ;
 * `allowHost(hostname)` ajoute d'autres hôtes ; `mock(url)` sert une réponse locale (URL) ou renvoie null.
 * Tout le reste est coupé. Les hôtes coupés sont ajoutés au Set renvoyé.
 * @param {import('playwright').BrowserContext} context
 * @param {{allowHost?: (hostname: string) => boolean, mock?: (url: URL) => ({status?: number, contentType?: string, body?: any, headers?: Record<string, string>} | null)}} [opts]
 * @returns {Promise<Set<string>>} hôtes bloqués, rempli au fil de la session
 */
export async function guardNetwork(context, { allowHost, mock } = {}) {
  const blocked = new Set();
  await context.route('**/*', (route) => {
    let url;
    try {
      url = new URL(route.request().url());
    } catch {
      return route.abort();
    }
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    const m = mock?.(url);
    if (m) return route.fulfill(mockResponse(m));
    if (isLocalHost(url.hostname) || allowHost?.(url.hostname)) return route.continue();
    blocked.add(url.host);
    return route.abort();
  });
  return blocked;
}

/** Réponse de mock : objet → JSON ; ACAO * par défaut (la page peut être sur un autre port). */
function mockResponse(m) {
  const isJson = m.body !== undefined && typeof m.body === 'object' && !Buffer.isBuffer(m.body);
  return {
    status: m.status ?? 200,
    contentType: m.contentType ?? (isJson ? 'application/json' : 'text/plain'),
    headers: { 'access-control-allow-origin': '*', ...(m.headers ?? {}) },
    body: isJson ? JSON.stringify(m.body) : (m.body ?? ''),
  };
}

/** Lance ffmpeg sans shell (chemins passés tels quels) ; erreur explicite si absent. */
function runFfmpeg(args) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8', windowsHide: true });
  if (r.error) throw new Error(`ffmpeg introuvable dans le PATH : ${r.error.message}`);
  if (r.status !== 0) throw new Error(`ffmpeg a échoué : ${(r.stderr || '').trim().slice(0, 400)}`);
}

function encodeWebp(src, dest, quality) {
  runFfmpeg(['-i', src, '-frames:v', '1', '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '6', dest]);
}

/**
 * Lit largeur, hauteur, durée (s) et présence d'audio d'un média, sans rien encoder.
 * @returns {{width: number|null, height: number|null, duration: number|null, hasAudio: boolean}}
 */
export function probeMedia(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file], { encoding: 'utf8', windowsHide: true });
  if (r.error) throw new Error(`ffmpeg introuvable dans le PATH : ${r.error.message}`);
  const text = r.stderr || '';
  const videoLine = text.split('\n').find((l) => /Stream #\d+:\d+.*: Video:/.test(l)) ?? '';
  const dims = /(\d{2,5})x(\d{2,5})/.exec(videoLine);
  const dur = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text);
  return {
    width: dims ? Number(dims[1]) : null,
    height: dims ? Number(dims[2]) : null,
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null,
    hasAudio: /Stream #\d+:\d+.*: Audio:/.test(text),
  };
}

/**
 * PNG → WebP : qualité décroissante (82, 74, 66, 58) jusqu'à passer sous `maxBytes`.
 * @param {{maxBytes?: number}} [opts] plafond en octets (défaut 250 000)
 * @returns {{q: number, bytes: number, kb: number, withinLimit: boolean}} dernière tentative
 */
export function toWebp(png, dest, { maxBytes = 250_000 } = {}) {
  let last = null;
  for (const q of WEBP_QUALITIES) {
    encodeWebp(png, dest, q);
    const bytes = statSync(dest).size;
    last = { q, bytes, kb: Math.round(bytes / 1024), withinLimit: bytes <= maxBytes };
    if (last.withinLimit) break;
  }
  return last;
}

/** Variante plus étroite en WebP (largeur `width`, hauteur proportionnelle, Lanczos). */
export function variant(src, dest, width = 1280, quality = 80) {
  runFfmpeg(['-i', src, '-vf', `scale=${width}:-2:flags=lanczos`, '-frames:v', '1', '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '6', dest]);
  return { bytes: statSync(dest).size };
}

/** Image de partage 1200×630 : mise à l'échelle puis recadrage centré, JPEG (-q:v 5). */
export function ogImage(src, dest) {
  runFfmpeg(['-i', src, '-vf', 'scale=1200:630:force_original_aspect_ratio=increase:flags=lanczos,crop=1200:630', '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '5', dest]);
  return { bytes: statSync(dest).size };
}

/**
 * Affiche WebP (q82) : image d'une vidéo à l'instant `at` (s, dans le clip), ou image fixe convertie telle quelle.
 * @param {string} videoOrPng fichier vidéo (.mp4, .webm, .mov, .mkv) ou image
 * @param {{at?: number, quality?: number}} [opts]
 */
export function posterFrom(videoOrPng, dest, { at = 0, quality = 82 } = {}) {
  const isVideo = VIDEO_EXT.has(extname(videoOrPng).toLowerCase());
  const input = isVideo ? ['-ss', at.toFixed(2), '-i', videoOrPng] : ['-i', videoOrPng];
  runFfmpeg([...input, '-frames:v', '1', '-c:v', 'libwebp', '-quality', String(quality), dest]);
  return { bytes: statSync(dest).size };
}

/**
 * Intervalles gardés d'un parcours : [from, to] privé des `cuts` (attentes et captures), en secondes vidéo.
 * @param {number} from
 * @param {number} to
 * @param {Array<[number, number]>} cuts
 * @returns {Array<[number, number]>}
 */
export function keptSegments(from, to, cuts) {
  const segs = [];
  let t = from;
  for (const [a, b] of [...cuts].sort((x, y) => x[0] - y[0])) {
    if (b <= t || a >= to) continue;
    if (a > t) segs.push([t, a]);
    t = Math.max(t, b);
  }
  if (t < to) segs.push([t, to]);
  return segs.filter(([a, b]) => b - a > 0.05);
}

/** Temps de sortie dans le clip correspondant à un instant `t` de la vidéo brute. */
export function clipTime(segs, t) {
  let out = 0;
  for (const [a, b] of segs) {
    if (t <= a) break;
    out += Math.min(t, b) - a;
  }
  return out;
}

/**
 * Monte le clip : ne garde que les intervalles `segs` (concat), H.264 yuv420p faststart, sans audio.
 * @param {string} videoFile vidéo brute Playwright
 * @param {string} dest fichier MP4 de sortie
 * @param {Array<[number, number]>} segs intervalles gardés (cf. keptSegments)
 */
export function cutClip(videoFile, dest, segs) {
  if (!segs.length) throw new Error('cutClip : aucun segment à garder');
  if (segs.length === 1) {
    runFfmpeg(['-ss', segs[0][0].toFixed(2), '-i', videoFile, '-t', (segs[0][1] - segs[0][0]).toFixed(2), ...ENC, dest]);
    return;
  }
  const parts = segs.map(([a, b], i) => `[0:v]trim=start=${a.toFixed(2)}:end=${b.toFixed(2)},setpts=PTS-STARTPTS[v${i}]`);
  parts.push(segs.map((_, i) => `[v${i}]`).join('') + `concat=n=${segs.length}:v=1:a=0[outv]`);
  runFfmpeg(['-i', videoFile, '-filter_complex', parts.join(';'), '-map', '[outv]', ...ENC, dest]);
}
