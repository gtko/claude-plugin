'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { measure, decide, run, statePath } = require('../context-budget.js');
const { handoffPath } = require('../handoff.js');

const HOOK = path.join(__dirname, '..', 'context-budget.js');
const CONFIG_FILE = path.join(__dirname, '..', 'hooks-config.json');
const CWD = 'C:\\dev\\app';
const GENERIC = '/compact garde : issue en cours, branche et worktree, décisions, reste à faire, agents en cours';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctxbudget-'));
}

// Seuils absolus du projet : delegation 200k, passation 300k, blocage 400k.
function makeConfig(root) {
  return {
    contextBudget: { delegateTokens: 200000, handoffTokens: 300000, blockTokens: 400000 },
    handoff: { dir: path.join(root, 'handoffs'), maxAgeHours: 48, maxInjectBytes: 8000 },
    stateDir: path.join(root, 'state'),
    stateMaxAgeHours: 48,
  };
}

// Transcript dont la derniere reponse principale porte ctx tokens d'entree.
function writeCtx(file, ctx, model = 'claude-y') {
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'salut' } }),
    JSON.stringify({ type: 'assistant', message: { model, usage: { input_tokens: ctx } } }),
  ].join('\n') + '\n');
}

function inputFor(file, prompt = 'continue') {
  return { session_id: 'sess-1', cwd: CWD, transcript_path: file, prompt };
}

// Ecrit le transcript a ctx, puis appelle decide avec l'etat donne.
function step(config, file, ctx, state, prompt, model) {
  writeCtx(file, ctx, model);
  return decide(inputFor(file, prompt), config, state);
}

function withEnv(name, value, fn) {
  const prev = process.env[name];
  process.env[name] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  }
}

// Lance le hook avec le vrai hooks-config.json ; HOME/USERPROFILE isoles pour ne rien toucher.
function runCli(stdin, env) {
  return spawnSync(process.execPath, [HOOK], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('measure : derniere reponse principale ; sidechain et lignes invalides ignorees', () => {
  const file = path.join(tmpRoot(), 't.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'user', message: { content: 'x' } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-x', usage: { input_tokens: 100, cache_creation_input_tokens: 300, cache_read_input_tokens: 600 } } }),
    JSON.stringify({ type: 'assistant', isSidechain: true, message: { model: 'claude-z', usage: { input_tokens: 99999 } } }),
    'pas du json',
  ].join('\n'));
  assert.deepStrictEqual(measure(file), { ctx: 1000, model: 'claude-x' });
});

test('measure : champs de cache absents comptent 0 ; modele absent -> null', () => {
  const file = path.join(tmpRoot(), 't.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 42 } } }) + '\n');
  assert.deepStrictEqual(measure(file), { ctx: 42, model: null });
});

test('measure : fichier absent ou sans reponse -> null', () => {
  const root = tmpRoot();
  assert.strictEqual(measure(path.join(root, 'absent.jsonl')), null);
  assert.strictEqual(measure(''), null);
  const file = path.join(root, 't.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'user', message: {} }) + '\n');
  assert.strictEqual(measure(file), null);
});

test('measure : ne lit que la fin du transcript (512 Ko)', () => {
  const file = path.join(tmpRoot(), 't.jsonl');
  const big = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(600 * 1024) } });
  const asst = JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 1000 } } });
  fs.writeFileSync(file, [asst, big].join('\n'));
  assert.strictEqual(measure(file), null);
  fs.writeFileSync(file, [big, asst].join('\n'));
  assert.strictEqual(measure(file).ctx, 1000);
});

test('premier appel sous le seuil : aucune sortie, etat = contexte mesure, pas de baseline', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const r = step(cfg, path.join(root, 't.jsonl'), 10000);
  assert.strictEqual(r.output, null);
  assert.strictEqual(r.json, null);
  assert.deepStrictEqual(r.state, { level: 'none', blocked: false, lastCtx: 10000 });
});

test('pas de mesure : etat inchange, rien en sortie', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const r = decide({ session_id: 's', transcript_path: path.join(root, 'absent.jsonl') }, cfg, undefined);
  assert.deepStrictEqual(r, { output: null, json: null, state: { level: 'none', blocked: false, lastCtx: null } });
});

test('200k : delegation seulement, annoncee une seule fois', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const file = path.join(root, 't.jsonl');
  let st = step(cfg, file, 10000).state;
  let r = step(cfg, file, 250000, st);
  assert.match(r.output, /^\[Budget contexte 250k \(seuil délégation 200k\)\] Délègue : /);
  assert.strictEqual(r.json, null);
  st = r.state;
  for (const ctx of [260000, 290000]) {
    r = step(cfg, file, ctx, st);
    assert.strictEqual(r.output, null, String(ctx));
    assert.strictEqual(r.json, null, String(ctx));
    st = r.state;
  }
  assert.strictEqual(st.lastCtx, 290000);
});

test('300k : passation, texte avec chemin et ligne /compact, annoncee une seule fois', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const file = path.join(root, 't.jsonl');
  let st = step(cfg, file, 10000).state;
  st = step(cfg, file, 250000, st).state; // delegation deja annoncee
  let r = step(cfg, file, 310000, st);
  assert.match(r.output, /^\[Budget contexte 310k \(seuil passation 300k\)\] Écris maintenant la passation dans /);
  assert.ok(r.output.includes(handoffPath(CWD, cfg)));
  assert.ok(r.output.includes('Vérification'));
  assert.ok(r.output.endsWith('\n' + GENERIC), 'sans passation : ligne generique');
  assert.strictEqual(r.json, null);
  st = r.state;
  for (const ctx of [320000, 350000]) {
    r = step(cfg, file, ctx, st);
    assert.strictEqual(r.output, null, String(ctx));
    assert.strictEqual(r.json, null, String(ctx));
    st = r.state;
  }
});

test('saut direct de 10k a 250k : delegation annoncee, pas de passation', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const file = path.join(root, 't.jsonl');
  const st = step(cfg, file, 10000).state;
  const r = step(cfg, file, 250000, st);
  assert.match(r.output, /^\[Budget contexte 250k \(seuil délégation 200k\)\] Délègue/);
  assert.strictEqual(r.state.level, 'delegate');
});

test('400k : blocage une seule fois, puis un seul avertissement, puis silence', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const file = path.join(root, 't.jsonl');
  const st = step(cfg, file, 10000).state;
  let r = step(cfg, file, 410000, st);
  assert.strictEqual(r.output, null);
  assert.strictEqual(r.json.decision, 'block');
  assert.match(r.json.reason, /^Ton message n'a pas été envoyé\. Contexte 410k tokens \(seuil blocage 400k\)\. Écris la passation/);
  assert.ok(r.json.reason.includes('/clear'));
  assert.ok(r.json.reason.includes('Pour continuer quand même, renvoie-le (copie-le avant).'));
  assert.strictEqual(r.state.blocked, true);
  r = step(cfg, file, 420000, r.state);
  assert.strictEqual(r.json, null);
  assert.match(r.output, /^\[Budget contexte 420k \(seuil blocage 400k\)\] Contexte toujours/);
  let st2 = r.state;
  for (const ctx of [430000, 440000]) {
    r = step(cfg, file, ctx, st2);
    assert.strictEqual(r.json, null, String(ctx));
    assert.strictEqual(r.output, null, String(ctx));
    st2 = r.state;
  }
});

test('saut direct de 10k a 410k : bloque sans passer par la delegation ni la passation', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const file = path.join(root, 't.jsonl');
  const st = step(cfg, file, 10000).state;
  const r = step(cfg, file, 410000, st);
  assert.strictEqual(r.json.decision, 'block');
  assert.strictEqual(r.output, null);
});

test('prompt « écris la passation » au blocage : consigne en texte, jamais de blocage', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const file = path.join(root, 't.jsonl');
  let st = step(cfg, file, 10000).state;
  for (const prompt of ['écris la passation', 'handoff maintenant']) {
    const r = step(cfg, file, 410000, st, prompt);
    assert.strictEqual(r.json, null, prompt);
    assert.match(r.output, /^\[Budget contexte 410k \(seuil passation 300k\)\] Écris maintenant la passation/, prompt);
    assert.strictEqual(r.state.blocked, false, prompt);
    st = r.state;
  }
});

test('chute de plus de 30 % (/clear ou compactage) : blocage re-arme', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const file = path.join(root, 't.jsonl');
  const st = step(cfg, file, 10000).state;
  let r = step(cfg, file, 410000, st);
  assert.strictEqual(r.json.decision, 'block');
  r = step(cfg, file, 9000, r.state); // 9000 < 410000 * 0.7
  assert.deepStrictEqual(r.state, { level: 'none', blocked: false, lastCtx: 9000 });
  assert.strictEqual(r.output, null);
  assert.strictEqual(r.json, null);
  r = step(cfg, file, 410000, r.state);
  assert.strictEqual(r.json.decision, 'block');
});

test('chute de plus de 30 % : la delegation est annoncee a nouveau', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const file = path.join(root, 't.jsonl');
  let st = step(cfg, file, 10000).state;
  st = step(cfg, file, 250000, st).state; // delegation
  let r = step(cfg, file, 240000, st); // -4 % : pas de remise a zero
  assert.strictEqual(r.output, null);
  assert.strictEqual(r.state.lastCtx, 240000);
  r = step(cfg, file, 150000, r.state); // -37 % : remise a zero, 150k sous le seuil
  assert.deepStrictEqual(r.state, { level: 'none', blocked: false, lastCtx: 150000 });
  assert.strictEqual(r.output, null);
  r = step(cfg, file, 250000, r.state);
  assert.match(r.output, /^\[Budget contexte 250k \(seuil délégation 200k\)\]/);
});

test('baisse de moins de 30 % apres le blocage : pas de rearmement, pas de nouveau blocage', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const file = path.join(root, 't.jsonl');
  const st = step(cfg, file, 10000).state;
  let r = step(cfg, file, 410000, st);
  assert.strictEqual(r.json.decision, 'block');
  r = step(cfg, file, 300000, r.state); // -27 % : pas de remise a zero
  assert.strictEqual(r.json, null);
  assert.strictEqual(r.output, null);
  r = step(cfg, file, 410000, r.state);
  assert.strictEqual(r.json, null, 'pas de second blocage');
  assert.match(r.output, /^\[Budget contexte 410k \(seuil blocage 400k\)\] Contexte toujours/);
});

test('CONTEXT_BUDGET=off : aucune sortie, etat intact', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const file = path.join(root, 't.jsonl');
  const st = step(cfg, file, 10000).state;
  const r = withEnv('CONTEXT_BUDGET', 'off', () => step(cfg, file, 410000, st));
  assert.deepStrictEqual(r, { output: null, json: null, state: st });
});

test('run : etat persiste par session et relu au prompt suivant', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const file = path.join(root, 't.jsonl');
  writeCtx(file, 10000);
  run(inputFor(file), cfg);
  const saved = JSON.parse(fs.readFileSync(statePath(cfg.stateDir, 'sess-1'), 'utf8'));
  assert.deepStrictEqual(saved, { level: 'none', blocked: false, lastCtx: 10000 });
  writeCtx(file, 250000);
  assert.match(run(inputFor(file), cfg).output, /Délègue/);
  assert.strictEqual(run(inputFor(file), cfg).output, null);
});

test('statePath : identifiant de session assaini', () => {
  assert.strictEqual(statePath('/x/state', '../evil'), path.join('/x/state', 'ctx-___evil.json'));
  assert.strictEqual(path.basename(statePath('/x/state', 'a/b')), 'ctx-a_b.json');
  assert.strictEqual(path.basename(statePath('/x/state', undefined)), 'ctx-default.json');
});

test('hooks-config : seuils absolus 200k / 300k / 400k, plus de fractions ni de plafond', () => {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).contextBudget;
  assert.strictEqual(cfg.delegateTokens, 200000);
  assert.strictEqual(cfg.handoffTokens, 300000);
  assert.strictEqual(cfg.blockTokens, 400000);
  for (const key of ['delegateAt', 'handoffAt', 'blockAt', 'absoluteMaxTokens', 'windowTokens']) {
    assert.ok(!(key in cfg), key);
  }
});

test('CLI : entree invalide -> fail-open (exit 0, sans sortie)', () => {
  const root = tmpRoot();
  const env = { HOME: root, USERPROFILE: root };
  for (const bad of ['', 'pas du json', '{"transcript_path":', 'null', '[]']) {
    const r = runCli(bad, env);
    assert.strictEqual(r.status, 0, JSON.stringify(bad));
    assert.strictEqual(r.stdout, '', JSON.stringify(bad));
  }
});

test('CLI e2e : config reelle, delegation injectee a 250k, etat dans le HOME de test', () => {
  const root = tmpRoot();
  const env = { HOME: root, USERPROFILE: root };
  const file = path.join(root, 't.jsonl');
  const input = JSON.stringify({ session_id: 'e2e', cwd: CWD, transcript_path: file, prompt: 'x' });
  writeCtx(file, 10000);
  let r = runCli(input, env);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
  writeCtx(file, 250000);
  r = runCli(input, env);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /^\[Budget contexte 250k \(seuil délégation 200k\)\] Délègue/);
  assert.ok(fs.existsSync(path.join(root, '.claude', 'hook-state', 'ctx-e2e.json')));
});

test('CLI : CONTEXT_BUDGET=off -> sortie vide, meme au-dela du blocage', () => {
  const root = tmpRoot();
  const file = path.join(root, 't.jsonl');
  writeCtx(file, 410000);
  const input = JSON.stringify({ session_id: 'off', cwd: CWD, transcript_path: file, prompt: 'x' });
  const r = runCli(input, { HOME: root, USERPROFILE: root, CONTEXT_BUDGET: 'off' });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});
