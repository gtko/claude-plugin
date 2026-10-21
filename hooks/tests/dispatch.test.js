'use strict';
// ABC-131 : dispatcher des hooks. Ordre, arret au premier refus, fail-open par module, matcher,
// sortie identique a l'appel direct (un cas par evenement).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { dispatch, merge, isRefusal, matches, HOOKS } = require('../dispatch.js');
const { handoffPath, loadConfig } = require('../handoff.js');

const HOOK_DIR = path.join(__dirname, '..');
const DISPATCH = path.join(HOOK_DIR, 'dispatch.js');
const hookFile = (f) => path.join(HOOK_DIR, f);
const ALLOW = { stdout: '', stderr: '', exitCode: 0 };
const bashLs = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } });

// Faux module : journalise son appel dans log ; renvoie res, ou leve si res est une Error.
function entry(name, log, res, matcher) {
  return {
    name,
    matcher,
    module: {
      hook: async () => {
        log.push(name);
        if (res instanceof Error) throw res;
        return res;
      },
    },
  };
}
const deny = (reason) => ({
  stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }),
  stderr: '',
  exitCode: 0,
});
const ctx = (text) => ({
  stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } }),
  stderr: '',
  exitCode: 0,
});
const text = (t) => ({ stdout: t, stderr: '', exitCode: 0 });

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-'));
}

// Lance un script node avec stdin ; HOME/USERPROFILE isoles, MODEL_CHECK coupe l'avertissement de modele.
function run(args, stdin, home) {
  return spawnSync(process.execPath, args, {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, MODEL_CHECK: 'off', HOME: home, USERPROFILE: home },
  });
}

// Execute fn avec HOME/USERPROFILE pointes sur home (os.homedir lit ces variables a chaque appel).
function withHome(home, fn) {
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return fn();
  } finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

// ---------------------------------------------------------------- ordre, arret, fail-open

test('ordre : les hooks tournent dans l\'ordre de la table', async () => {
  const log = [];
  const r = await dispatch('PreToolUse', bashLs, [entry('a', log, ALLOW), entry('b', log, ALLOW), entry('c', log, ALLOW)]);
  assert.deepStrictEqual(log, ['a', 'b', 'c']);
  assert.deepStrictEqual(r, { stdout: '', stderr: '', exitCode: 0 });
});

test('arret au premier refus : les suivants ne tournent pas, la sortie du refus est restituee telle quelle', async () => {
  const log = [];
  const d = deny('refus de b');
  const r = await dispatch('PreToolUse', bashLs, [entry('a', log, ALLOW), entry('b', log, d), entry('c', log, ctx('jamais'))]);
  assert.deepStrictEqual(log, ['a', 'b']);
  assert.strictEqual(r.stdout, d.stdout);
  assert.strictEqual(r.exitCode, 0);
});

test('arret au premier refus : exit 2 avec stderr restitue', async () => {
  const log = [];
  const r = await dispatch('PreToolUse', bashLs, [
    entry('a', log, { stdout: '', stderr: 'bloque par a', exitCode: 2 }),
    entry('b', log, ALLOW),
  ]);
  assert.deepStrictEqual(log, ['a']);
  assert.strictEqual(r.exitCode, 2);
  assert.match(r.stderr, /bloque par a/);
});

test('decision "block" (UserPromptSubmit) arrete aussi la chaine', async () => {
  const log = [];
  const block = text(JSON.stringify({ decision: 'block', reason: 'budget' }));
  const r = await dispatch('UserPromptSubmit', '{}', [entry('a', log, block), entry('b', log, ALLOW)]);
  assert.deepStrictEqual(log, ['a']);
  assert.strictEqual(r.stdout, block.stdout);
});

test('module qui plante : ignore avec message sur stderr, les suivants s\'executent', async () => {
  const log = [];
  const r = await dispatch('UserPromptSubmit', '{}', [
    entry('a', log, new Error('boom')),
    entry('b', log, text('texte B')),
  ]);
  assert.deepStrictEqual(log, ['a', 'b']);
  assert.strictEqual(r.stdout, 'texte B');
  assert.match(r.stderr, /\[dispatch\] a ignoré : boom/);
  assert.strictEqual(r.exitCode, 0);
});

test('module introuvable (require qui echoue) : ignore, les suivants s\'executent', async () => {
  const log = [];
  const r = await dispatch('PreToolUse', bashLs, [{ file: 'inexistant.js' }, entry('b', log, ctx('ok'))]);
  assert.deepStrictEqual(log, ['b']);
  assert.match(r.stderr, /inexistant\.js ignoré/);
  assert.strictEqual(r.stdout, ctx('ok').stdout);
});

// ---------------------------------------------------------------- matcher

test('matcher : seuls les hooks dont le matcher correspond a tool_name tournent', async () => {
  const log = [];
  const table = [entry('agent', log, ALLOW, 'Agent'), entry('shell', log, ALLOW, 'Bash|PowerShell'), entry('tout', log, ALLOW)];
  await dispatch('PreToolUse', bashLs, table);
  assert.deepStrictEqual(log, ['shell', 'tout']);
  log.length = 0;
  await dispatch('PreToolUse', JSON.stringify({ tool_name: 'Agent', tool_input: {} }), table);
  assert.deepStrictEqual(log, ['agent', 'tout']);
  log.length = 0;
  await dispatch('PreToolUse', JSON.stringify({ tool_name: 'BashX', tool_input: {} }), table);
  assert.deepStrictEqual(log, ['tout']);
});

test('matches : regex ancree sur le nom d\'outil', () => {
  assert.strictEqual(matches('Bash|PowerShell', 'PowerShell'), true);
  assert.strictEqual(matches('Agent', 'Agent2'), false);
  assert.strictEqual(matches('Agent', 'Task'), false);
});

// ---------------------------------------------------------------- sorties

test('sorties : une seule restituee telle quelle ; plusieurs concatenees ; additionalContext fusionne en JSON', async () => {
  const log = [];
  const r = await dispatch('UserPromptSubmit', '{}', [entry('a', log, text('A')), entry('b', log, text('B'))]);
  assert.strictEqual(r.stdout, 'A\nB');
  assert.strictEqual(
    merge('PreToolUse', [ctx('X').stdout, 'texte']),
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'X\ntexte' } })
  );
});

test('isRefusal : exit 2, deny et block seulement', () => {
  assert.strictEqual(isRefusal(deny('x')), true);
  assert.strictEqual(isRefusal({ stdout: '', stderr: '', exitCode: 2 }), true);
  assert.strictEqual(isRefusal(text(JSON.stringify({ decision: 'block' }))), true);
  assert.strictEqual(isRefusal(ctx('x')), false);
  assert.strictEqual(isRefusal(text('texte libre')), false);
});

test('table : chaque fichier reference existe', () => {
  for (const hooks of Object.values(HOOKS)) {
    for (const h of hooks) assert.ok(fs.existsSync(hookFile(h.file)), h.file);
  }
});

// ---------------------------------------------------------------- sortie identique a l'appel direct (un cas par evenement)

test('identique au direct, PreToolUse : refus routing-guard (Agent general-purpose)', () => {
  const stdin = JSON.stringify({ tool_name: 'Agent', tool_input: { subagent_type: 'general-purpose', prompt: 'x' } });
  const direct = run([hookFile('routing-guard.js')], stdin, tmpHome());
  const via = run([DISPATCH, 'PreToolUse'], stdin, tmpHome());
  assert.match(direct.stdout, /permissionDecision/);
  assert.strictEqual(via.stdout, direct.stdout);
  assert.strictEqual(via.status, direct.status);
});

test('identique au direct, PreToolUse : refus tool-guard (rm -rf /)', () => {
  const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf /' } });
  const direct = run([hookFile('tool-guard.js')], stdin, tmpHome());
  const via = run([DISPATCH, 'PreToolUse'], stdin, tmpHome());
  assert.match(direct.stdout, /commande destructrice/);
  assert.strictEqual(via.stdout, direct.stdout);
  assert.strictEqual(via.status, direct.status);
});

test('identique au direct, UserPromptSubmit : rappel [Routage] (model-router seul, context-budget muet)', () => {
  const stdin = JSON.stringify({ session_id: 'abc131-direct', prompt: 'salut' });
  const direct = run([hookFile('model-router.js')], stdin, tmpHome());
  const via = run([DISPATCH, 'UserPromptSubmit'], stdin, tmpHome());
  assert.match(direct.stdout, /\[Routage\]/);
  assert.strictEqual(via.stdout, direct.stdout);
  assert.strictEqual(via.status, direct.status);
});

test('identique au direct, SessionStart : passation injectee (handoff seul)', () => {
  const home = tmpHome();
  const cwd = path.join(home, 'projet');
  const file = withHome(home, () => handoffPath(cwd, loadConfig()));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# Passation test\nReste a faire : ABC-131 dispatch\n');
  const stdin = JSON.stringify({ session_id: 'abc131-start', source: 'startup', cwd });
  const direct = run([hookFile('handoff.js')], stdin, home);
  const via = run([DISPATCH, 'SessionStart'], stdin, home);
  assert.match(direct.stdout, /Passation test/);
  assert.strictEqual(via.stdout, direct.stdout);
  assert.strictEqual(via.status, direct.status);
});

test('identique au direct, PreCompact : meme exit et meme passation ecrite (pre-compact seul)', () => {
  const cwd = path.join(tmpHome(), 'projet');
  const stdin = JSON.stringify({ session_id: 'abc131-compact', cwd, transcript_path: path.join(cwd, 'absent.jsonl') });
  const homeDirect = tmpHome();
  const homeVia = tmpHome();
  const direct = run([hookFile('pre-compact.js')], stdin, homeDirect);
  const via = run([DISPATCH, 'PreCompact'], stdin, homeVia);
  const fileIn = (home) => withHome(home, () => handoffPath(cwd, loadConfig()));
  assert.ok(fs.existsSync(fileIn(homeDirect)), 'la passation doit etre ecrite par l\'appel direct');
  assert.strictEqual(via.stdout, direct.stdout);
  assert.strictEqual(via.status, direct.status);
  assert.strictEqual(fs.existsSync(fileIn(homeVia)), true);
});

// ---------------------------------------------------------------- ligne de commande

test('CLI : evenement inconnu -> message sur stderr, exit 0 (fail-open)', () => {
  const r = run([DISPATCH, 'EvenementInconnu'], '{}', tmpHome());
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /événement inconnu/);
});

test('CLI : PreToolUse lu une seule fois sur stdin, refus restitue', () => {
  const stdin = JSON.stringify({ tool_name: 'Agent', tool_input: { subagent_type: 'general-purpose', prompt: 'x' } });
  const r = run([DISPATCH, 'PreToolUse'], stdin, tmpHome());
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /\[routing-guard\]/);
});

// ABC-134 : plugin gtko-agents actif -> la copie legacy (sans CLAUDE_PLUGIN_ROOT) sort sans lancer les hooks.
const REFUS_ROUTING = JSON.stringify({ tool_name: 'Agent', tool_input: { subagent_type: 'general-purpose', prompt: 'x' } });

// CLAUDE_CONFIG_DIR isole (settings.json optionnel) ; CLAUDE_PLUGIN_ROOT retire sauf si pluginRoot.
function runWithConfig(stdin, { settings, pluginRoot = false }) {
  const cfg = tmpHome();
  if (settings !== undefined) fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify(settings));
  const env = { ...process.env, MODEL_CHECK: 'off', HOME: tmpHome(), USERPROFILE: tmpHome(), CLAUDE_CONFIG_DIR: cfg };
  delete env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot) env.CLAUDE_PLUGIN_ROOT = HOOK_DIR;
  return spawnSync(process.execPath, [DISPATCH, 'PreToolUse'], { input: stdin, encoding: 'utf8', env });
}

test('plugin gtko-agents active (enabledPlugins) sans CLAUDE_PLUGIN_ROOT : sortie 0, aucun hook lance', () => {
  const r = runWithConfig(REFUS_ROUTING, { settings: { enabledPlugins: { 'gtko-agents@gtko': true } } });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
  assert.strictEqual(r.stderr, '');
});

test('marketplace de dev gtko-agents@gtko-dev : plugin actif (on) ou inactif (off), comme gtko-agents@gtko', () => {
  const on = runWithConfig(REFUS_ROUTING, { settings: { enabledPlugins: { 'gtko-agents@gtko-dev': true } } });
  assert.strictEqual(on.status, 0);
  assert.strictEqual(on.stdout, '');
  const off = runWithConfig(REFUS_ROUTING, { settings: { enabledPlugins: { 'gtko-agents@gtko-dev': false } } });
  assert.strictEqual(off.status, 0);
  assert.match(off.stdout, /\[routing-guard\]/);
});

test('sans enabledPlugins (fichier absent ou plugin desactive) : comportement inchange, refus restitue', () => {
  const sansFichier = runWithConfig(REFUS_ROUTING, {});
  const desactive = runWithConfig(REFUS_ROUTING, { settings: { enabledPlugins: { 'gtko-agents@gtko': false } } });
  for (const r of [sansFichier, desactive]) {
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /\[routing-guard\]/);
  }
});

test('CLAUDE_PLUGIN_ROOT present : le plugin lance ses hooks meme si enabledPlugins est true', () => {
  const r = runWithConfig(REFUS_ROUTING, { settings: { enabledPlugins: { 'gtko-agents@gtko': true } }, pluginRoot: true });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /\[routing-guard\]/);
});
