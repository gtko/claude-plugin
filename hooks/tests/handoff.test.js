'use strict';
const test = require('node:test');
const { before, after } = test;
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { handoffPath, decide, slug, expandHome } = require('../handoff.js');
const { statePath } = require('../context-budget.js');

// Les tests de passation ne dependent pas du modele : MODEL_CHECK=off pendant tout le fichier.
// Les tests de modele passent leurs propres options (modelOpts) ou un env explicite (MODEL_CHECK: 'on' en CLI).
let prevModelCheck;
before(() => {
  prevModelCheck = process.env.MODEL_CHECK;
  process.env.MODEL_CHECK = 'off';
});
after(() => {
  if (prevModelCheck === undefined) delete process.env.MODEL_CHECK;
  else process.env.MODEL_CHECK = prevModelCheck;
});

const HOOK = path.join(__dirname, '..', 'handoff.js');
const HOUR = 3600 * 1000;
const CWD = 'C:\\dev\\app';
const SLUG = 'c-dev-app';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-'));
}

function makeConfig(root) {
  const cfg = {
    handoff: { dir: path.join(root, 'handoffs'), maxAgeHours: 48, maxInjectBytes: 8000 },
    stateDir: path.join(root, 'state'),
    stateMaxAgeHours: 48,
  };
  fs.mkdirSync(cfg.handoff.dir, { recursive: true });
  return cfg;
}

// Ecrit la passation du projet CWD dans le dossier de config.
function writeHandoff(cfg, body) {
  const f = handoffPath(CWD, cfg);
  fs.writeFileSync(f, body);
  return f;
}

// Vieillit un fichier de `hours` heures.
function ageFile(file, hours) {
  const t = (Date.now() - hours * HOUR) / 1000;
  fs.utimesSync(file, t, t);
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

test('slug : minuscules, [a-z0-9], tirets fusionnes, bornes retirees', () => {
  assert.strictEqual(slug(CWD), SLUG);
  assert.strictEqual(slug('/home/x//y__Z.'), 'home-x-y-z');
  assert.strictEqual(slug('--a  b--'), 'a-b');
});

test('handoffPath : <dir>/<slug>.md, ~ developpe', () => {
  const cfg = makeConfig(tmpRoot());
  assert.strictEqual(handoffPath(CWD, cfg), path.join(cfg.handoff.dir, SLUG + '.md'));
  const home = { ...cfg, handoff: { ...cfg.handoff, dir: '~/.claude/handoffs' } };
  assert.strictEqual(handoffPath(CWD, home), path.join(os.homedir(), '.claude', 'handoffs', SLUG + '.md'));
  assert.strictEqual(expandHome('~'), os.homedir());
});

test('startup : injecte la passation sans la renommer', () => {
  const cfg = makeConfig(tmpRoot());
  const f = writeHandoff(cfg, '# Passation\n\n## Reste à faire\n1. Finir le hook\n');
  const r = decide({ session_id: 's', cwd: CWD, source: 'startup' }, cfg);
  assert.ok(r.output.startsWith('[Passation chargée depuis ' + f + ']\n'));
  assert.ok(r.output.includes('1. Finir le hook'));
  assert.ok(fs.existsSync(f));
  assert.ok(!fs.existsSync(f.replace(/\.md$/, '.loaded.md')));
});

test('consigne d\'injection : ne reprendre que si la demande prolonge la tache', () => {
  const cfg = makeConfig(tmpRoot());
  writeHandoff(cfg, 'contenu');
  const r = decide({ cwd: CWD, source: 'compact' }, cfg);
  assert.ok(r.output.endsWith('Si la demande actuelle prolonge cette tâche, reprends à partir de « Reste à faire » ; sinon ignore cette passation. Mets à jour ou supprime ce fichier quand la tâche est finie.\n'));
  assert.ok(!r.output.includes('Reprends à partir de « Reste à faire ». '));
});

test('clear : renomme aussi, en ecrasant un ancien .loaded.md', () => {
  const cfg = makeConfig(tmpRoot());
  const f = writeHandoff(cfg, 'nouvelle passation');
  const loaded = f.replace(/\.md$/, '.loaded.md');
  fs.writeFileSync(loaded, 'ancienne passation');
  const r = decide({ cwd: CWD, source: 'clear' }, cfg);
  assert.ok(r.output.includes('nouvelle passation'));
  assert.strictEqual(fs.readFileSync(loaded, 'utf8'), 'nouvelle passation');
  assert.ok(!fs.existsSync(f));
});

test('compact et resume : injecte sans renommer', () => {
  for (const source of ['compact', 'resume']) {
    const cfg = makeConfig(tmpRoot());
    const f = writeHandoff(cfg, 'contenu');
    const r = decide({ cwd: CWD, source }, cfg);
    assert.ok(r.output.includes('contenu'), source);
    assert.ok(fs.existsSync(f), source);
    assert.ok(!fs.existsSync(f.replace(/\.md$/, '.loaded.md')), source);
  }
});

test('passation trop vieille ignoree ; assez recente injectee', () => {
  const cfg = makeConfig(tmpRoot());
  const f = writeHandoff(cfg, 'vieille');
  ageFile(f, 49);
  const old = decide({ cwd: CWD, source: 'startup' }, cfg);
  assert.strictEqual(old.output, null);
  assert.ok(fs.existsSync(f));
  ageFile(f, 47);
  assert.ok(decide({ cwd: CWD, source: 'compact' }, cfg).output.includes('vieille'));
});

test('absente ou vide : aucune sortie', () => {
  const cfg = makeConfig(tmpRoot());
  assert.strictEqual(decide({ cwd: CWD, source: 'startup' }, cfg).output, null);
  writeHandoff(cfg, '   \n');
  assert.strictEqual(decide({ cwd: CWD, source: 'startup' }, cfg).output, null);
});

test('troncature a maxInjectBytes avec mention (tronqué)', () => {
  const cfg = makeConfig(tmpRoot());
  cfg.handoff.maxInjectBytes = 100;
  writeHandoff(cfg, 'a'.repeat(1000));
  const r = decide({ cwd: CWD, source: 'compact' }, cfg);
  assert.ok(r.output.includes('a'.repeat(100)));
  assert.ok(!r.output.includes('a'.repeat(101)));
  assert.ok(r.output.includes('(tronqué)'));
});

test('passation courte : pas de mention de troncature', () => {
  const cfg = makeConfig(tmpRoot());
  writeHandoff(cfg, 'court');
  const r = decide({ cwd: CWD, source: 'compact' }, cfg);
  assert.ok(!r.output.includes('(tronqué)'));
});

test('HANDOFF=off : rien n\'est injecte ni renomme', () => {
  const cfg = makeConfig(tmpRoot());
  const f = writeHandoff(cfg, 'x');
  const r = withEnv('HANDOFF', 'off', () => decide({ cwd: CWD, source: 'startup' }, cfg));
  assert.strictEqual(r.output, null);
  assert.ok(fs.existsSync(f));
});

test('compact et clear : suppriment l\'etat context-budget de la session, startup le garde', () => {
  for (const source of ['compact', 'clear', 'startup']) {
    const cfg = makeConfig(tmpRoot());
    fs.mkdirSync(cfg.stateDir, { recursive: true });
    const sid = 'sess-' + source;
    const own = statePath(cfg.stateDir, sid);
    const other = statePath(cfg.stateDir, 'autre');
    fs.writeFileSync(own, '{"baseline":1}');
    fs.writeFileSync(other, '{}');
    decide({ session_id: sid, cwd: CWD, source }, cfg);
    assert.strictEqual(fs.existsSync(own), source === 'startup', source);
    assert.ok(fs.existsSync(other), source);
  }
});

test('nettoyage : fichiers d\'etat plus vieux que stateMaxAgeHours supprimes', () => {
  const cfg = makeConfig(tmpRoot());
  fs.mkdirSync(cfg.stateDir, { recursive: true });
  const old = path.join(cfg.stateDir, 'ctx-old.json');
  fs.writeFileSync(old, '{}');
  ageFile(old, 49);
  const recent = path.join(cfg.stateDir, 'ctx-new.json');
  fs.writeFileSync(recent, '{}');
  decide({ cwd: CWD, source: 'startup' }, cfg);
  assert.ok(!fs.existsSync(old));
  assert.ok(fs.existsSync(recent));
});

test('entree non objet : aucune action, pas de nettoyage', () => {
  const cfg = makeConfig(tmpRoot());
  fs.mkdirSync(cfg.stateDir, { recursive: true });
  const old = path.join(cfg.stateDir, 'ctx-old.json');
  fs.writeFileSync(old, '{}');
  ageFile(old, 49);
  for (const bad of [null, [], 'texte']) {
    assert.deepStrictEqual(decide(bad, cfg), { output: null });
  }
  assert.ok(fs.existsSync(old));
});

test('CLI : entree invalide -> fail-open (exit 0, sans sortie)', () => {
  const root = tmpRoot();
  const env = { HOME: root, USERPROFILE: root };
  for (const bad of ['', 'pas du json', '{"cwd":', 'null', '[]']) {
    const r = runCli(bad, env);
    assert.strictEqual(r.status, 0, JSON.stringify(bad));
    assert.strictEqual(r.stdout, '', JSON.stringify(bad));
  }
});

test('CLI e2e : config reelle, passation injectee et renommee dans le HOME de test', () => {
  const root = tmpRoot();
  const env = { HOME: root, USERPROFILE: root };
  const dir = path.join(root, '.claude', 'handoffs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, SLUG + '.md'), 'Reste à faire : test e2e');
  const r = runCli(JSON.stringify({ session_id: 'e2e', cwd: CWD, source: 'clear' }), env);
  assert.strictEqual(r.status, 0);
  assert.ok(r.stdout.includes('Reste à faire : test e2e'));
  assert.ok(fs.existsSync(path.join(dir, SLUG + '.loaded.md')));
});

test('CLI : HANDOFF=off -> sortie vide, fichier conserve', () => {
  const root = tmpRoot();
  const env = { HOME: root, USERPROFILE: root, HANDOFF: 'off' };
  const dir = path.join(root, '.claude', 'handoffs');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, SLUG + '.md');
  fs.writeFileSync(f, 'x');
  const r = runCli(JSON.stringify({ cwd: CWD, source: 'startup' }), env);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
  assert.ok(fs.existsSync(f));
});

// Modele de session isole : aucune source reelle (env ou settings.json de la machine).
function modelOpts(cfg, extra) {
  return { env: {}, settingsPath: path.join(cfg.handoff.dir, 'settings-absent.json'), ...extra };
}

const MODEL_LINE = "[Modèle] Session sur claude-opus-5-5 ; l'orchestrateur prévu est sonnet (/model pour changer).";

test('modele non conforme + passation : ligne d\'avertissement, puis la passation', () => {
  const cfg = makeConfig(tmpRoot());
  const f = writeHandoff(cfg, 'Reste à faire : combiné');
  const input = { session_id: 's', cwd: CWD, source: 'startup', model: 'claude-opus-5-5' };
  const r = decide(input, cfg, modelOpts(cfg));
  assert.ok(r.output.startsWith(MODEL_LINE + '\n[Passation chargée depuis ' + f + ']\n'));
  assert.ok(r.output.includes('Reste à faire : combiné'));
  assert.ok(fs.existsSync(f));
});

test('modele non conforme sans passation : seulement la ligne', () => {
  const cfg = makeConfig(tmpRoot());
  const r = decide({ cwd: CWD, source: 'startup', model: 'claude-opus-5-5' }, cfg, modelOpts(cfg));
  assert.strictEqual(r.output, MODEL_LINE + '\n');
});

test('modele conforme + passation : passation seule, sans avertissement', () => {
  const cfg = makeConfig(tmpRoot());
  writeHandoff(cfg, 'contenu');
  const r = decide({ cwd: CWD, source: 'startup', model: 'claude-sonnet-4-6' }, cfg, modelOpts(cfg));
  assert.ok(r.output.startsWith('[Passation chargée depuis '));
  assert.ok(!r.output.includes('[Modèle]'));
});

test('MODEL_CHECK=off : passation seule, meme pour un modele non conforme', () => {
  const cfg = makeConfig(tmpRoot());
  writeHandoff(cfg, 'contenu');
  const input = { cwd: CWD, source: 'startup', model: 'claude-opus-5-5' };
  const r = decide(input, cfg, modelOpts(cfg, { env: { MODEL_CHECK: 'off' } }));
  assert.ok(r.output.startsWith('[Passation chargée depuis '));
  assert.ok(!r.output.includes('[Modèle]'));
});

test('HANDOFF=off : l\'avertissement reste, la passation non', () => {
  const cfg = makeConfig(tmpRoot());
  const f = writeHandoff(cfg, 'x');
  const input = { cwd: CWD, source: 'startup', model: 'claude-opus-5-5' };
  const r = withEnv('HANDOFF', 'off', () => decide(input, cfg, modelOpts(cfg)));
  assert.strictEqual(r.output, MODEL_LINE + '\n');
  assert.ok(fs.existsSync(f));
});

test('CLI : modele non conforme via ANTHROPIC_MODEL, ligne en sortie', () => {
  const root = tmpRoot();
  const env = { HOME: root, USERPROFILE: root, ANTHROPIC_MODEL: 'claude-opus-5-5', MODEL_CHECK: 'on' };
  const r = runCli(JSON.stringify({ cwd: CWD, source: 'startup' }), env);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, MODEL_LINE + '\n');
});

test('CLI : sans entree de modele, repli sur ~/.claude/settings.json', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ model: 'claude-opus-5-5' }));
  const env = { HOME: root, USERPROFILE: root, ANTHROPIC_MODEL: '', MODEL_CHECK: 'on' };
  const r = runCli(JSON.stringify({ cwd: CWD, source: 'startup' }), env);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, MODEL_LINE + '\n');
});
