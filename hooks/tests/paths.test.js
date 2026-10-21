'use strict';
const test = require('node:test');
const { after } = test;
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { configDir, hookStateDir, handoffsDir, expandConfigPath } = require('../lib/paths.js');
const { handoffPath, decide, loadConfig, stateDirOf } = require('../handoff.js');
const { run, statePath } = require('../context-budget.js');
const { rappelFor, RAPPEL } = require('../model-router.js');
const { defaultSettingsPath } = require('../model-check.js');

const CWD = 'C:\\Users\\grego\\Projets\\laststream';
const SLUG = 'c-users-grego-projets-laststream';
const dirs = [];

function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'paths-test-'));
  dirs.push(d);
  return d;
}
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

// Environnement isole : pas de CLAUDE_PLUGIN_DATA, pas d'interrupteurs, MODEL_CHECK coupe. undefined = supprime.
function isolated(extra, fn) {
  const vars = { CLAUDE_PLUGIN_DATA: undefined, HANDOFF: undefined, CONTEXT_BUDGET: undefined, MODEL_CHECK: 'off', CLAUDE_CONFIG_DIR: undefined, ...extra };
  const prev = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test('configDir : CLAUDE_CONFIG_DIR sinon ~/.claude, lu a chaque appel', () => {
  isolated({}, () => {
    assert.strictEqual(configDir(), path.join(os.homedir(), '.claude'));
    assert.strictEqual(hookStateDir(), path.join(os.homedir(), '.claude', 'hook-state'));
    assert.strictEqual(handoffsDir(), path.join(os.homedir(), '.claude', 'handoffs'));
  });
  const root = tmp();
  isolated({ CLAUDE_CONFIG_DIR: root }, () => {
    assert.strictEqual(configDir(), root);
    assert.strictEqual(hookStateDir(), path.join(root, 'hook-state'));
    assert.strictEqual(handoffsDir(), path.join(root, 'handoffs'));
  });
});

test('expandConfigPath : ~/.claude suit CLAUDE_CONFIG_DIR ; ~ et ~/ vont au dossier personnel ; le reste inchange', () => {
  const root = tmp();
  isolated({ CLAUDE_CONFIG_DIR: root }, () => {
    assert.strictEqual(expandConfigPath('~/.claude/hook-state'), path.join(root, 'hook-state'));
    assert.strictEqual(expandConfigPath('~/.claude'), root);
    assert.strictEqual(expandConfigPath('~/.claude-autre/x'), path.join(os.homedir(), '.claude-autre', 'x'));
    assert.strictEqual(expandConfigPath('~'), os.homedir());
    assert.strictEqual(expandConfigPath('~/projets'), path.join(os.homedir(), 'projets'));
    assert.strictEqual(expandConfigPath(root), root);
  });
});

test('defaut inchange : sans CLAUDE_CONFIG_DIR, passations, etat et settings restent sous ~/.claude', () => {
  isolated({}, () => {
    const cfg = loadConfig();
    assert.strictEqual(handoffPath(CWD, cfg), path.join(os.homedir(), '.claude', 'handoffs', SLUG + '.md'));
    assert.strictEqual(stateDirOf(cfg), path.join(os.homedir(), '.claude', 'hook-state'));
    assert.strictEqual(defaultSettingsPath(), path.join(os.homedir(), '.claude', 'settings.json'));
  });
});

test('CLAUDE_CONFIG_DIR : passation lue et chemins d\'etat sous ce dossier', () => {
  const root = tmp();
  isolated({ CLAUDE_CONFIG_DIR: root }, () => {
    const cfg = loadConfig();
    const file = path.join(root, 'handoffs', SLUG + '.md');
    assert.strictEqual(handoffPath(CWD, cfg), file);
    assert.strictEqual(stateDirOf(cfg), path.join(root, 'hook-state'));
    assert.strictEqual(defaultSettingsPath(), path.join(root, 'settings.json'));
    fs.mkdirSync(path.join(root, 'handoffs'), { recursive: true });
    fs.writeFileSync(file, '# Passation\n\n## Reste à faire\n1. Finir le hook\n');
    const r = decide({ session_id: 's0', cwd: CWD, source: 'startup' }, cfg);
    assert.ok(r.output.startsWith('[Passation chargée depuis ' + file + ']\n'));
  });
});

test('CLAUDE_CONFIG_DIR : etat context-budget ecrit dans hook-state', () => {
  const root = tmp();
  const transcript = path.join(root, 'transcript.jsonl');
  const turn = { type: 'assistant', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 250000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } };
  fs.writeFileSync(transcript, JSON.stringify(turn) + '\n');
  isolated({ CLAUDE_CONFIG_DIR: root }, () => {
    const res = run({ session_id: 'sess-1', cwd: CWD, transcript_path: transcript }, loadConfig());
    assert.match(res.output, /^\[Budget contexte 250k \(seuil délégation 200k\)\]/);
    const file = path.join(root, 'hook-state', 'ctx-sess-1.json');
    assert.strictEqual(statePath(hookStateDir(), 'sess-1'), file);
    assert.ok(fs.existsSync(file), 'etat attendu dans CLAUDE_CONFIG_DIR/hook-state');
  });
});

test('CLAUDE_CONFIG_DIR : rappel de routage emis une seule fois, etat dans hook-state', () => {
  const root = tmp();
  isolated({ CLAUDE_CONFIG_DIR: root }, () => {
    const cfg = loadConfig();
    assert.strictEqual(rappelFor({ session_id: 'sess-2' }, cfg), RAPPEL);
    assert.strictEqual(rappelFor({ session_id: 'sess-2' }, cfg), '');
    assert.ok(fs.existsSync(path.join(root, 'hook-state', 'router-sess-2.json')));
  });
});
