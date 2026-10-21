// PostToolUse (Bash|PowerShell) et PreToolUse : la CI doit etre verifiee APRES le dernier push, en sequence.
// PostToolUse : note la fin de chaque `git push` et chaque `gh pr checks` (debut, fin, resultat).
// PreToolUse : refuse le passage d'une issue Linear en « In Review » (MCP save_issue / update_issue, ou CLI
// `linear issue update`) si aucun `gh pr checks` n'a demarre apres la fin du dernier push de la session, ou si
// ce dernier controle n'est pas vert. Le controle doit etre un appel d'outil separe, lance apres le retour du push :
// un `gh pr checks` du meme lot parallele, ou de la meme commande (`git push && gh pr checks`), ne compte pas.
// Etat par session dans stateDir/ci-<session>.json. Interrupteur : CI_GATE=off. Fail-open sur toute erreur.
// Exporte decide(input, config, deps) pour les tests.
'use strict';
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./lib/config.js');
const { expandConfigPath, hookStateDir } = require('./lib/paths.js');

const SHELL_TOOLS = ['Bash', 'PowerShell'];
const PUSH_RE = /\bgit(?:\s+-[Cc]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+push\b/;
const CHECKS_RE = /\bgh\s+pr\s+checks\b/;
const DRY_RUN_RE = /--dry-run\b/;
const LINEAR_TOOL_RE = /linear/i;
const LINEAR_SAVE_RE = /(?:save|update)_issue$/i;
const IN_REVIEW_RE = /^\s*in\s+review\s*$/i;
const CLI_IN_REVIEW_RE = /\blinear\s+issue\s+update\b[^\n;&|]*?(?:--state|--status|-s)[ =]+["']?in review\b/i;

const NOT_CHECKED = 'In Review refusé : la CI n\'a pas été vérifiée après le dernier push. Pousse d\'abord et attends la fin du push, puis lance `gh pr checks <pr> --watch` dans un appel séparé (jamais dans la même commande ni le même lot parallèle qu\'un push, un commit ou un gh pr create), sur le head de la PR (`git rev-parse HEAD` = `gh pr view --json headRefOid`).';
const NOT_GREEN = 'In Review refusé : le dernier `gh pr checks` après le push n\'est pas vert. Échec d\'infrastructure : `gh run rerun <id> --failed` sans toucher au code ; échec réel : corrige, pousse, puis revérifie la CI.';

function stateFile(cfg, sid) {
  const dir = cfg.stateDir ? expandConfigPath(cfg.stateDir) : hookStateDir();
  return path.join(dir, 'ci-' + String(sid || 'default').replace(/[^A-Za-z0-9_-]/g, '_') + '.json');
}

function readState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch (e) {
    return {};
  }
}

function writeState(file, s) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(s));
  } catch (e) { /* etat perdu : fail-open */ }
}

function defaultDeps() {
  return { env: process.env, now: () => Date.now(), read: readState, write: writeState };
}

// Index d'une commande dans le texte, ou -1 (un push --dry-run ne compte pas).
function pushIndex(cmd) {
  const m = PUSH_RE.exec(cmd);
  return m && !DRY_RUN_RE.test(cmd.slice(m.index)) ? m.index : -1;
}
const checksIndex = (cmd) => {
  const m = CHECKS_RE.exec(cmd);
  return m ? m.index : -1;
};

// Resultat de gh pr checks : true vert (ou aucune CI), false rouge ou en attente, null illisible.
// Le dernier resume fait foi (--watch reimprime l'etat a chaque rafraichissement).
function checksGreen(response) {
  const text = typeof response === 'string' ? response
    : response && typeof response === 'object' ? [response.stdout, response.stderr, response.output].filter((x) => typeof x === 'string').join('\n') : '';
  if (/no checks reported/i.test(text)) return true;
  const summaries = [...text.matchAll(/All checks were successful|Some checks were not successful|Some checks are still pending|Some checks were cancelled/gi)];
  if (summaries.length) return /All checks were successful/i.test(summaries[summaries.length - 1][0]);
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    try {
      const list = JSON.parse(trimmed);
      if (Array.isArray(list)) return list.every((c) => /^(pass|skipping|success)$/i.test(String(c && (c.bucket || c.state))));
    } catch (e) { /* format inconnu */ }
  }
  if (/\t(?:fail|pending|cancel)\b/i.test(text)) return false;
  if (/\tpass\b/i.test(text)) return true;
  return null;
}

// Passage d'une issue en In Review demande par cet appel d'outil.
function isInReview(input) {
  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  if (SHELL_TOOLS.includes(input.tool_name)) return typeof ti.command === 'string' && CLI_IN_REVIEW_RE.test(ti.command);
  if (!LINEAR_TOOL_RE.test(input.tool_name) || !LINEAR_SAVE_RE.test(input.tool_name)) return false;
  return [ti.state, ti.status, ti.stateName].some((v) => typeof v === 'string' && IN_REVIEW_RE.test(v));
}

// Retourne une raison de refus (PreToolUse) ou null. PostToolUse : met l'etat a jour, retourne null.
function decide(input, config, deps) {
  try {
    const d = { ...defaultDeps(), ...(deps || {}) };
    if (d.env.CI_GATE === 'off') return null;
    if (!input || typeof input !== 'object' || typeof input.tool_name !== 'string') return null;
    const cfg = config || loadConfig();
    if (cfg.ciGate && cfg.ciGate.enabled === false) return null;
    const file = stateFile(cfg, input.session_id);
    const event = input.hook_event_name;
    const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
    const cmd = SHELL_TOOLS.includes(input.tool_name) && typeof ti.command === 'string' ? ti.command : '';
    const id = String(input.tool_use_id || 'sans-id');

    if (event === 'PreToolUse') {
      if (cmd && checksIndex(cmd) >= 0) {
        const s = d.read(file);
        s.pending = { ...(s.pending || {}), [id]: d.now() };
        d.write(file, s);
      }
      if (!isInReview(input)) return null;
      const s = d.read(file);
      if (!s.lastPushDone) return null; // aucun push dans la session : rien a exiger
      const c = s.checks;
      if (!c || !(c.start > s.lastPushDone)) return NOT_CHECKED;
      return c.green === false ? NOT_GREEN : null;
    }

    if (event === 'PostToolUse' && cmd) {
      const p = pushIndex(cmd);
      const k = checksIndex(cmd);
      if (p < 0 && k < 0) return null;
      const s = d.read(file);
      const now = d.now();
      const start = (s.pending && s.pending[id]) || now;
      if (s.pending) delete s.pending[id];
      // Push et controle dans une meme commande : le push se termine avec la commande, apres le debut du controle.
      if (k >= 0) s.checks = { start, done: now, green: checksGreen(input.tool_response) };
      if (p >= 0) s.lastPushDone = now;
      d.write(file, s);
    }
    return null;
  } catch (e) {
    return null;
  }
}

function hook(raw) {
  let stdout = '';
  try {
    const input = JSON.parse(raw);
    const reason = decide(input);
    if (reason) {
      stdout = JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '[ci-gate] ' + reason },
      });
    }
  } catch (e) { /* fail-open */ }
  return { stdout, stderr: '', exitCode: 0 };
}

function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (e) { /* fail-open */ }
  const r = hook(raw);
  if (r.stdout) process.stdout.write(r.stdout);
  process.exit(0);
}

if (require.main === module) main();
module.exports = { decide, hook, checksGreen, isInReview };
