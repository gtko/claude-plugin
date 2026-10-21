// SessionStart : reinjecte la passation du projet (<handoff.dir>/<slug>.md) dans le contexte.
// Sur clear, la passation est renommee en <slug>.loaded.md pour ne pas resurgir ailleurs.
// Sur compact et clear, l'etat context-budget et l'etat du rappel [Routage] de la session sont supprimes (repartent de zero).
// Avertit aussi (une ligne, model-check.js) si la session ne tourne pas sur l'orchestrateur prevu.
// Exporte handoffPath, decide(input, config, opts), slug, expandHome, stateDirOf, handoffsDirOf, loadConfig, PRECOMPACT_BLOCK ; fail-open.
'use strict';
const fs = require('fs');
const path = require('path');
const { hookStateDir, handoffsDir, expandConfigPath } = require('./lib/paths.js');
const { loadConfig } = require('./lib/config.js');

const HOUR_MS = 3600 * 1000;
const RENAME_SOURCE = 'clear';
const RESET_SOURCES = ['compact', 'clear'];
// Bloc ecrit par pre-compact.js en fin de passation (rafraichi a chaque compactage).
const PRECOMPACT_BLOCK = /\n?<!-- precompact -->[\s\S]*?<!-- \/precompact -->\n?/g;

// ~ ou ~/ -> dossier personnel ; ~/.claude/... -> dossier de configuration (CLAUDE_CONFIG_DIR respecte).
function expandHome(p) {
  return expandConfigPath(p);
}

// Dossier d'etat (stateDir) et dossier des passations (handoff.dir) : valeurs de hooks-config.json, sinon ceux de configDir().
function stateDirOf(config) {
  return config.stateDir ? expandHome(config.stateDir) : hookStateDir();
}

function handoffsDirOf(config) {
  return config.handoff && config.handoff.dir ? expandHome(config.handoff.dir) : handoffsDir();
}

// Identifiant du projet : cwd en minuscules, [a-z0-9] seulement, tirets fusionnes, bornes retirees.
function slug(cwd) {
  const s = String(cwd || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s || 'default';
}

function handoffPath(cwd, config) {
  return path.join(handoffsDirOf(config), slug(cwd) + '.md');
}

// Supprime les fichiers d'etat plus vieux que stateMaxAgeHours (opportuniste).
function cleanupState(config) {
  const dir = stateDirOf(config);
  const limit = Date.now() - config.stateMaxAgeHours * HOUR_MS;
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return; }
  for (const name of names) {
    const f = path.join(dir, name);
    try {
      const st = fs.statSync(f);
      if (st.isFile() && st.mtimeMs < limit) fs.unlinkSync(f);
    } catch (e) { /* ignore */ }
  }
}

// Supprime l'etat context-budget de la session (meme chemin que context-budget.js).
// Require paresseux : context-budget.js requiert ce fichier.
function resetContextState(sessionId, config) {
  try {
    const { statePath } = require('./context-budget.js');
    fs.unlinkSync(statePath(stateDirOf(config), sessionId));
  } catch (e) { /* absent ou illisible : rien a faire */ }
}

// Supprime l'etat du rappel [Routage] (model-router.js) : il revient une fois apres compactage ou /clear.
function resetRouterState(sessionId, config) {
  try {
    const { routerStatePath } = require('./model-router.js');
    fs.unlinkSync(routerStatePath(stateDirOf(config), sessionId));
  } catch (e) { /* absent ou illisible : rien a faire */ }
}

// Texte de la passation a injecter, ou null ; HANDOFF=off la desactive.
function passation(input, config) {
  const none = null;
  if (process.env.HANDOFF === 'off') return none;
  cleanupState(config);
  if (RESET_SOURCES.includes(input.source) && typeof input.session_id === 'string' && input.session_id) {
    resetContextState(input.session_id, config);
  }

  const file = handoffPath(input.cwd, config);
  if (!fs.existsSync(file)) return none;
  const st = fs.statSync(file);
  if (Date.now() - st.mtimeMs > config.handoff.maxAgeHours * HOUR_MS) return none;

  // Troncature en octets ; le caractere de remplacement final vient d'une sequence UTF-8 coupee.
  const buf = fs.readFileSync(file);
  const max = config.handoff.maxInjectBytes;
  const truncated = buf.length > max;
  let body = (truncated ? buf.subarray(0, max) : buf).toString('utf8');
  if (truncated) body = body.replace(/�$/, '');
  if (!body.trim()) return none;

  const lines = ['[Passation chargée depuis ' + file + ']', body.trimEnd()];
  if (truncated) lines.push('(tronqué)');
  lines.push('Si la demande actuelle prolonge cette tâche, reprends à partir de « Reste à faire » ; sinon ignore cette passation. Mets à jour ou supprime ce fichier quand la tâche est finie.');
  if (input.source === RENAME_SOURCE) {
    try { fs.renameSync(file, file.replace(/\.md$/, '.loaded.md')); } catch (e) { /* ignore */ }
  }
  return lines.join('\n');
}

// Retourne { output } : avertissement de modele (une ligne), puis passation ; sinon null.
// opts (tests) : { env, settingsPath } pour la verification de modele.
function decide(input, config, opts) {
  const none = { output: null };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return none;
  // Le rappel de routage repart de zero sur compact et clear, independamment de HANDOFF.
  if (RESET_SOURCES.includes(input.source) && typeof input.session_id === 'string' && input.session_id) {
    resetRouterState(input.session_id, config);
  }
  const parts = [];
  const warning = modelWarning(input, config, opts);
  if (warning) parts.push(warning);
  const text = passation(input, config);
  if (text) parts.push(text);
  return parts.length ? { output: parts.join('\n') + '\n' } : none;
}

// Require paresseux et fail-open : sans model-check.js, le hook reste une simple passation.
function modelWarning(input, config, opts) {
  try { return require('./model-check.js').checkModel(input, config, opts); } catch (e) { return null; }
}

// Exports avant main : context-budget.js (charge par decide) requiert ce fichier.
module.exports = { handoffPath, decide, slug, expandHome, stateDirOf, handoffsDirOf, loadConfig, PRECOMPACT_BLOCK, hook };

// Sortie du hook sans I/O (appele par dispatch.js) : passation / avertissement de modele, ou rien. Fail-open.
function hook(raw) {
  let stdout = '';
  try {
    const res = decide(JSON.parse(raw), loadConfig());
    if (res.output) stdout = res.output;
  } catch (e) { /* fail-open */ }
  return { stdout, stderr: '', exitCode: 0 };
}

function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (e) { /* fail-open */ }
  const r = hook(raw);
  if (r.stdout) process.stdout.write(r.stdout);
  process.exitCode = 0;
}

if (require.main === module) main();
