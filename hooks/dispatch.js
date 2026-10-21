// Dispatcher des hooks Claude Code (ABC-131) : un seul processus node par evenement.
// Usage : node dispatch.js <Evenement>   (stdin = entree JSON du hook, lue une seule fois)
// Execute par require, dans l'ordre de HOOKS, les hooks de l'evenement. matcher = regex ancree sur tool_name.
// - Premier refus (exit 2, decision "block", permissionDecision "deny") : sa sortie est restituee telle quelle, les suivants ne tournent pas.
// - Sinon : une seule sortie non vide est restituee telle quelle ; plusieurs sont concatenees (texte, ou additionalContext en JSON).
// - Fail-open par module : une exception (y compris un require qui echoue) est signalee sur stderr, les suivants s'executent.
// Chaque module expose hook(raw) -> { stdout, stderr, exitCode } (ou Promise) ; son main() reste son point d'entree seul.
'use strict';
const fs = require('fs');
const path = require('path');
const { configDir } = require('./lib/paths.js');

// Hooks par evenement, dans l'ordre de settings.json. file : relatif a ce dossier ; matcher absent = tous les outils.
const HOOKS = {
  SessionStart: [{ file: 'handoff.js' }],
  UserPromptSubmit: [{ file: 'model-router.js' }, { file: 'context-budget.js' }],
  PreCompact: [{ file: 'pre-compact.js' }],
  PreToolUse: [
    { file: 'routing-guard.js', matcher: 'Agent' },
    { file: 'heavy-gate.js', matcher: 'Bash|PowerShell' },
    { file: 'process-gate.js', matcher: 'Bash|PowerShell' },
    { file: 'tool-guard.js' },
    { file: 'ci-gate.js' },
  ],
  PostToolUse: [{ file: 'ci-gate.js', matcher: 'Bash|PowerShell' }],
};

function parseJson(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    return null;
  }
}

// additionalContext porte par une sortie JSON, ou null si la sortie n'en a pas.
function additionalContextOf(stdout) {
  const j = parseJson(stdout);
  const ctx = j && j.hookSpecificOutput && j.hookSpecificOutput.additionalContext;
  return typeof ctx === 'string' ? ctx : null;
}

// Refus : exit 2, decision "block" (UserPromptSubmit) ou permissionDecision "deny" (PreToolUse).
function isRefusal(res) {
  if (res.exitCode === 2) return true;
  const j = parseJson(res.stdout);
  if (!j) return false;
  if (j.decision === 'block') return true;
  return Boolean(j.hookSpecificOutput) && j.hookSpecificOutput.permissionDecision === 'deny';
}

// Plusieurs sorties non vides : texte concatene ; si l'une est du JSON additionalContext, sortie JSON unique.
// Une seule sortie : restituee telle quelle (sortie identique a l'appel direct).
function merge(event, outs) {
  if (outs.length === 1) return outs[0];
  const texts = outs.map((o) => additionalContextOf(o) ?? o);
  const asJson = outs.some((o) => additionalContextOf(o) !== null);
  if (!asJson) return texts.join('\n');
  return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: texts.join('\n') } });
}

// Matcher Claude Code : regex ancree sur le nom d'outil (ex. "Bash|PowerShell").
function matches(matcher, toolName) {
  return new RegExp('^(?:' + matcher + ')$').test(toolName);
}

// Lance les hooks de l'evenement et renvoie { stdout, stderr, exitCode }.
// hooks : table de l'evenement (defaut HOOKS[event]) ; une entree peut porter `module` au lieu de `file` (tests).
async function dispatch(event, raw, hooks = HOOKS[event] || []) {
  const input = parseJson(raw);
  const toolName = input && typeof input.tool_name === 'string' ? input.tool_name : '';
  const outs = [];
  let stderr = '';
  for (const h of hooks) {
    if (h.matcher && !matches(h.matcher, toolName)) continue;
    const name = h.file || h.name || '?';
    let res;
    try {
      const mod = h.module || require(path.join(__dirname, h.file));
      res = await mod.hook(raw);
    } catch (e) {
      stderr += `[dispatch] ${name} ignoré : ${e && e.message ? e.message : e}\n`;
      continue;
    }
    res = { stdout: res.stdout || '', stderr: res.stderr || '', exitCode: res.exitCode || 0 };
    stderr += res.stderr;
    if (isRefusal(res)) return { stdout: res.stdout, stderr, exitCode: res.exitCode };
    if (res.stdout) outs.push(res.stdout);
  }
  return { stdout: outs.length ? merge(event, outs) : '', stderr, exitCode: 0 };
}

// Ecrit la sortie puis quitte (le flush de stdout/stderr est attendu avant exit).
function finish(res) {
  const exit = () => process.exit(res.exitCode);
  const flushErr = () => (res.stderr ? process.stderr.write(res.stderr, exit) : exit());
  if (res.stdout) process.stdout.write(res.stdout, flushErr);
  else flushErr();
}

// Plugin gtko-agents actif (enabledPlugins dans settings.json) : le plugin lance ses hooks (CLAUDE_PLUGIN_ROOT present).
// La copie legacy (hooks de ~/.claude) sort tout de suite, sans lancer aucun hook, pour ne pas passer deux fois.
const PLUGIN_IDS = ['gtko-agents@gtko', 'gtko-agents@gtko-dev']; // prod, puis marketplace de dev de config (gtko-dev)
function pluginTakesOver() {
  if (process.env.CLAUDE_PLUGIN_ROOT) return false;
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(configDir(), 'settings.json'), 'utf8'));
    return Boolean(settings && settings.enabledPlugins && PLUGIN_IDS.some((id) => settings.enabledPlugins[id] === true));
  } catch (e) {
    return false;
  }
}

async function main() {
  if (pluginTakesOver()) process.exit(0);
  const event = process.argv[2];
  if (!Object.prototype.hasOwnProperty.call(HOOKS, event)) {
    process.stderr.write(`[dispatch] événement inconnu : ${event}\n`, () => process.exit(0));
    return;
  }
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (e) { /* entree absente : chaque hook decide */ }
  finish(await dispatch(event, raw));
}

if (require.main === module) main();
module.exports = { HOOKS, dispatch, merge, isRefusal, matches };
