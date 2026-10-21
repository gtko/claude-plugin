#!/usr/bin/env node
// Génère docs/assets/mascot.gif : la petite étincelle-mascotte en pixel art, animée.
// Node pur, zéro dépendance. Encodeur GIF89a maison : palette globale, compression
// LZW (clear/EOI, largeur de code qui passe jusqu'à 12 bits), extension NETSCAPE2.0
// (boucle infinie) et Graphic Control Extension (délai, index 0 transparent).
//
// Usage : node scripts/mascot-gif.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GRID = 24; // grille logique, en pixels
export const SCALE = 8; // agrandissement entier
export const SIZE = GRID * SCALE; // 192 px

// Palette globale. L'index 0 est transparent (GCE) : le fond suit la page, clair ou sombre.
export const PALETTE = [
  [0xff, 0xff, 0xff], // 0 transparent (blanc si le viewer ignore la transparence)
  [0x4a, 0x24, 0x18], // 1 contour brun foncé
  [0xd9, 0x77, 0x57], // 2 terracotta
  [0xb8, 0x5c, 0x3e], // 3 ombre terracotta
  [0xf2, 0xa3, 0x88], // 4 reflet
  [0x2b, 0x1a, 0x14], // 5 yeux
  [0xff, 0xf6, 0xee], // 6 reflet des yeux
  [0xf7, 0xb4, 0xa0], // 7 joues
  [0xc9, 0xb5, 0xa8], // 8 ombre portée au sol
];
const TR = 0;
const K = 1, O = 2, D = 3, H = 4, E = 5, W = 6, C = 7, S = 8;

// Corps : [gauche, droite] par ligne, à partir de BODY_TOP (pointe de flamme en haut).
const BODY_TOP = 3;
const BODY = [
  [11, 12], [10, 13], [9, 14], [8, 15], [7, 16], [7, 16],
  [6, 17], [6, 17], [6, 17], [6, 17], [6, 17], [6, 17], [6, 17], [6, 17],
  [7, 16], [7, 16], [8, 15], [9, 14],
];
const ARM_L = [[4, 12], [5, 12], [4, 13], [5, 13], [4, 14], [5, 14]];
const ARM_R = [[18, 12], [19, 12], [18, 13], [19, 13], [18, 14], [19, 14]];
const ARM_WAVE = {
  A: [[18, 12], [19, 12], [18, 11], [19, 11], [19, 10], [20, 10], [19, 9], [20, 9], [20, 8], [21, 8], [20, 7], [21, 7], [20, 6], [21, 6]],
  B: [[18, 12], [19, 12], [18, 11], [19, 11], [19, 10], [20, 10], [20, 9], [21, 9], [21, 8], [22, 8], [21, 7], [22, 7]],
};
const EYES_OPEN = [
  [9, 10, W], [10, 10, E], [9, 11, E], [10, 11, E], [9, 12, E], [10, 12, E],
  [13, 10, W], [14, 10, E], [13, 11, E], [14, 11, E], [13, 12, E], [14, 12, E],
];
const EYES_BLINK = [[9, 11, E], [10, 11, E], [13, 11, E], [14, 11, E]];
const FACE = [[7, 13, C], [8, 13, C], [15, 13, C], [16, 13, C], [10, 14, E], [13, 14, E], [11, 15, E], [12, 15, E]];

// Une image par entrée. off : décalage vertical (rebond), arm : pose du bras droit levé.
// delay en centièmes de seconde (12 = 120 ms).
const SEQUENCE = [
  { off: 0, eyes: 'open', arm: null, delay: 25 }, // repos
  { off: 0, eyes: 'blink', arm: null, delay: 5 }, // clin d'œil
  { off: 0, eyes: 'open', arm: 'A', delay: 12 }, // salut, bras levé
  { off: 0, eyes: 'open', arm: 'B', delay: 12 }, // salut, bras qui bouge
  { off: 0, eyes: 'open', arm: 'A', delay: 12 }, // salut
  { off: -1, eyes: 'open', arm: null, delay: 8 }, // rebond : montée
  { off: -2, eyes: 'open', arm: null, delay: 8 }, // rebond : sommet
  { off: -1, eyes: 'open', arm: null, delay: 8 }, // rebond : retombée
];

function bodyColor(x, y, L, R) {
  if (y >= 16 && x >= 11) return D; // ombre bas-droite
  if (x === R - 1 && y >= 9) return D; // liseré d'ombre à droite
  if (x === L + 1 && y >= 5 && y <= 12) return H; // reflet haut-gauche
  return O;
}

function shadowRows(off) {
  // [ligne, x0, x1] : l'ombre se rétrécit quand la mascotte est en l'air
  if (off === 0) return [[22, 7, 16], [23, 9, 14]];
  if (off === -1) return [[22, 8, 15]];
  return [[22, 9, 14]];
}

function renderGrid({ off, eyes, arm }) {
  const painted = new Map(); // "x,y" (coordonnées finales) -> index de palette
  const put = (x, y, c) => painted.set(`${x},${y + off}`, c);

  BODY.forEach(([L, R], i) => {
    const y = BODY_TOP + i;
    for (let x = L; x <= R; x++) put(x, y, bodyColor(x, y, L, R));
  });
  for (const [x, y] of [...ARM_L, ...(arm ? ARM_WAVE[arm] : ARM_R)]) put(x, y, O);
  for (const [x, y, c] of [...(eyes === 'blink' ? EYES_BLINK : EYES_OPEN), ...FACE]) put(x, y, c);

  const grid = new Uint8Array(GRID * GRID); // 0 = transparent
  const solid = new Uint8Array(GRID * GRID);
  for (const [key, c] of painted) {
    const [x, y] = key.split(',').map(Number);
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) throw new Error(`pixel hors grille : ${key}`);
    grid[y * GRID + x] = c;
    solid[y * GRID + x] = 1;
  }

  // Contour : chaque case vide collée (4-voisinage) au sprite prend la couleur de contour.
  const solidAt = (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID && solid[y * GRID + x] === 1;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (solid[y * GRID + x]) continue;
      if (solidAt(x - 1, y) || solidAt(x + 1, y) || solidAt(x, y - 1) || solidAt(x, y + 1)) {
        grid[y * GRID + x] = K;
      }
    }
  }

  for (const [y, x0, x1] of shadowRows(off)) {
    for (let x = x0; x <= x1; x++) if (!solid[y * GRID + x]) grid[y * GRID + x] = S;
  }
  return grid;
}

function upscale(grid) {
  const out = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const row = Math.floor(y / SCALE) * GRID;
    for (let x = 0; x < SIZE; x++) out[y * SIZE + x] = grid[row + Math.floor(x / SCALE)];
  }
  return out;
}

export function buildFrames() {
  return SEQUENCE.map((s) => ({ indices: upscale(renderGrid(s)), delay: s.delay, transparentIndex: TR }));
}

// Compression LZW GIF (LSB d'abord). Le décodeur ajoute ses entrées avec un tour de retard :
// l'encodeur élargit donc le code dès que son prochain index vaut 2^n + 1 (et non 2^n).
export function lzwEncode(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const MAX = 4096;
  const out = [];
  let acc = 0;
  let nbits = 0;
  let codeSize = minCodeSize + 1;
  let dict = new Map(); // (préfixe << 8 | octet) -> code
  let next = eoi + 1;

  const emit = (code) => {
    acc |= code << nbits;
    nbits += codeSize;
    while (nbits >= 8) {
      out.push(acc & 0xff);
      acc >>>= 8;
      nbits -= 8;
    }
  };

  emit(clear);
  if (indices.length > 0) {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = prefix * 256 + k;
      const hit = dict.get(key);
      if (hit !== undefined) {
        prefix = hit;
        continue;
      }
      emit(prefix);
      dict.set(key, next);
      next++;
      if (next === (1 << codeSize) + 1 && codeSize < 12) codeSize++;
      if (next === MAX) {
        // Table pleine : on repart de zéro par un clear (code de 12 bits).
        emit(clear);
        dict = new Map();
        next = eoi + 1;
        codeSize = minCodeSize + 1;
      }
      prefix = k;
    }
    emit(prefix);
    // Miroir du décodeur pour le dernier code : même règle d'élargissement.
    next++;
    if (next === (1 << codeSize) + 1 && codeSize < 12) codeSize++;
  }
  emit(eoi);
  if (nbits > 0) out.push(acc & 0xff);
  return Buffer.from(out);
}

function subBlocks(data) {
  const parts = [];
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.subarray(i, Math.min(i + 255, data.length));
    parts.push(Buffer.from([chunk.length]), chunk);
  }
  return Buffer.concat(parts);
}

export function encodeGif({ width, height, palette, frames, loop = 0 }) {
  let bits = 2;
  while (1 << bits < palette.length) bits++;
  if (bits > 8) throw new Error('palette > 256 couleurs');
  const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
  const parts = [];
  const head = (...bytes) => parts.push(Buffer.from(bytes));

  parts.push(Buffer.from('GIF89a', 'latin1'));
  // Logical Screen Descriptor : table globale présente, 8 bits de couleur, taille 2^bits.
  head(...u16(width), ...u16(height), 0x80 | (7 << 4) | (bits - 1), 0, 0);
  const gct = Buffer.alloc(3 << bits);
  palette.forEach(([r, g, b], i) => {
    gct[i * 3] = r;
    gct[i * 3 + 1] = g;
    gct[i * 3 + 2] = b;
  });
  parts.push(gct);

  // Application Extension NETSCAPE2.0 : nombre de boucles (0 = infinie).
  head(0x21, 0xff, 0x0b);
  parts.push(Buffer.from('NETSCAPE2.0', 'latin1'));
  head(0x03, 0x01, ...u16(loop), 0x00);

  for (const f of frames) {
    const hasTr = f.transparentIndex !== undefined;
    // Graphic Control Extension : disposition 1 (laisser en place), délai en centièmes.
    head(0x21, 0xf9, 0x04, (1 << 2) | (hasTr ? 1 : 0), ...u16(f.delay), hasTr ? f.transparentIndex : 0, 0x00);
    // Image Descriptor : pleine image, sans table locale ni entrelacement.
    head(0x2c, ...u16(0), ...u16(0), ...u16(width), ...u16(height), 0x00);
    head(bits);
    parts.push(subBlocks(lzwEncode(f.indices, bits)));
    head(0x00);
  }
  head(0x3b);
  return Buffer.concat(parts);
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const OUTPUT = resolve(HERE, '..', 'docs', 'assets', 'mascot.gif');

function main() {
  const frames = buildFrames();
  const gif = encodeGif({ width: SIZE, height: SIZE, palette: PALETTE, frames, loop: 0 });
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, gif);
  console.log(`${OUTPUT} : ${gif.length} octets, ${frames.length} images, ${SIZE}x${SIZE}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
