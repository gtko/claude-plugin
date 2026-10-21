// PreCompact : avant un compactage (manuel ou auto), ecrit ou rafraichit la passation du projet
// (<handoff.dir>/<slug>.md) pour que le compactage garde le fil.
// Passation absente, plus vieille que handoff.maxAgeHours (meme seuil que handoff.js) ou automatique :
// une passation minimale neuve est ecrite (date, cwd, branche, declencheur, consignes, derniers messages utilisateur).
// Trop vieille : mise de cote en <slug>.stale.md (remplace le precedent). Automatique : regeneree entierement.
// Passation humaine : seul le bloc <!-- precompact --> en fin de fichier est remplace ; le reste ne bouge pas.
// Ne bloque jamais : aucune sortie de decision, exit 0, erreurs avalees. HANDOFF=off : ne fait rien.
// Exporte refreshPassation(input, config, opts) ; opts (tests) : { now, branch } ; fail-open.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { handoffPath, loadConfig, PRECOMPACT_BLOCK } = require('./handoff.js');
const { readTail } = require('./context-budget.js');

const USER_MESSAGES = 5;
const MESSAGE_CHARS = 200;
const GIT_TIMEOUT_MS = 3000;
const HOUR_MS = 3600 * 1000;
// En-tete de la passation minimale : sa presence identifie une passation automatique (regeneree en entier).
const AUTO_HEADER = '# Passation (automatique, PreCompact)';

// Branche git courante du dossier, ou 'inconnue' (pas de depot, git absent, delai depasse).
function gitBranch(cwd) {
  try {
    const r = spawnSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    });
    const out = typeof r.stdout === 'string' ? r.stdout.trim() : '';
    if (r.status === 0 && out) return out;
  } catch (e) { /* inconnue */ }
  return 'inconnue';
}

// Texte d'un message utilisateur : chaine, ou blocs texte (les resultats d'outil n'ont pas de texte).
function userText(obj) {
  const c = obj.message && obj.message.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join(' ');
}

// Les derniers messages utilisateur reels du transcript (du plus ancien au plus recent), tronques.
function lastUserMessages(transcriptPath) {
  const out = [];
  try {
    if (typeof transcriptPath !== 'string' || !transcriptPath) return out;
    const lines = readTail(transcriptPath).split('\n');
    for (let i = lines.length - 1; i >= 0 && out.length < USER_MESSAGES; i--) {
      let obj;
      try { obj = JSON.parse(lines[i]); } catch (e) { continue; }
      if (!obj || obj.type !== 'user' || obj.isSidechain === true || obj.isMeta === true) continue;
      const t = userText(obj).replace(/<!--|-->/g, '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      out.unshift(t.length > MESSAGE_CHARS ? t.slice(0, MESSAGE_CHARS - 1) + '…' : t);
    }
  } catch (e) { /* transcript illisible : liste vide */ }
  return out;
}

// Declencheur (manual, auto) : mot court, sinon 'inconnu'.
function triggerOf(input) {
  const t = typeof input.trigger === 'string' ? input.trigger.trim() : '';
  return /^[a-z]{1,20}$/.test(t) ? t : 'inconnu';
}

// Consignes de compactage (custom_instructions), sur une ligne et sans marqueur de bloc.
function consignesOf(input) {
  const c = typeof input.custom_instructions === 'string' ? input.custom_instructions : '';
  return c.replace(/<!--|-->/g, '').replace(/\s+/g, ' ').trim();
}

// Passation minimale, creee quand le projet n'en a pas.
function minimalPassation(info) {
  const lines = [
    AUTO_HEADER,
    '',
    '- Date : ' + info.date,
    '- Cwd : ' + info.cwd,
    '- Branche : ' + info.branch,
    '- Déclencheur : ' + info.trigger,
  ];
  if (info.consignes) lines.push('- Consignes de compactage : ' + info.consignes);
  if (info.messages && info.messages.length) {
    lines.push('', '## Derniers messages utilisateur');
    for (const m of info.messages) lines.push('- ' + m);
  }
  return lines.join('\n') + '\n';
}

// Bloc delimite ajoute en fin de passation existante.
function precompactBlock(info) {
  const lines = [
    '<!-- precompact -->',
    '- Compactage (PreCompact) : ' + info.date,
    '- Déclencheur : ' + info.trigger,
    '- Branche : ' + info.branch,
  ];
  if (info.consignes) lines.push('- Consignes de compactage : ' + info.consignes);
  lines.push('<!-- /precompact -->');
  return lines.join('\n') + '\n';
}

// Remplace l'ancien bloc (s'il existe) par le nouveau, en fin de fichier ; le reste est conserve tel quel.
function withBlock(current, block) {
  const rest = current.replace(PRECOMPACT_BLOCK, '');
  if (rest === '') return block;
  const sep = rest.endsWith('\n\n') ? '' : rest.endsWith('\n') ? '\n' : '\n\n';
  return rest + sep + block;
}

// Ecrit ou rafraichit la passation du projet ; retourne son chemin, ou null si rien n'a ete fait.
function refreshPassation(input, config, opts) {
  const o = opts || {};
  if (process.env.HANDOFF === 'off') return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (typeof input.cwd !== 'string' || !input.cwd) return null;
  const file = handoffPath(input.cwd, config);
  const info = {
    date: (o.now || new Date()).toISOString(),
    cwd: input.cwd,
    branch: (o.branch || gitBranch)(input.cwd),
    trigger: triggerOf(input),
    consignes: consignesOf(input),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    // Meme calcul de fraicheur que handoff.js : une passation trop vieille ne serait pas rechargee, elle est mise de cote.
    if (Date.now() - fs.statSync(file).mtimeMs > config.handoff.maxAgeHours * HOUR_MS) {
      try { fs.renameSync(file, file.replace(/\.md$/, '.stale.md')); } catch (e) { /* ecrasee ci-dessous */ }
    } else {
      const current = fs.readFileSync(file, 'utf8');
      if (!current.startsWith(AUTO_HEADER)) {
        fs.writeFileSync(file, withBlock(current, precompactBlock(info)));
        return file;
      }
      // Passation automatique precedente : regeneree entierement (messages a jour).
    }
  }
  info.messages = lastUserMessages(input.transcript_path);
  fs.writeFileSync(file, minimalPassation(info));
  return file;
}

// Sortie du hook sans I/O (appele par dispatch.js) : ecrit la passation, ne decide jamais. Jamais bloquant.
function hook(raw) {
  try {
    refreshPassation(JSON.parse(raw), loadConfig());
  } catch (e) { /* jamais bloquant */ }
  return { stdout: '', stderr: '', exitCode: 0 };
}

function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (e) { /* jamais bloquant */ }
  hook(raw);
  process.exitCode = 0;
}

module.exports = { refreshPassation, lastUserMessages, minimalPassation, precompactBlock, withBlock, hook };
if (require.main === module) main();
