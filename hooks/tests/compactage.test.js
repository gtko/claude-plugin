'use strict';
// ODY-135 : compactage guide. Seuils context-budget (une annonce, un blocage, un avertissement),
// ligne /compact, rappel [Routage] une fois par session, pre-compact (passation, bloc, jamais bloquant).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { decide, compactLine } = require('../context-budget.js');
const { handoffPath, slug } = require('../handoff.js');
const { refreshPassation } = require('../pre-compact.js');

const ROUTER = path.join(__dirname, '..', 'model-router.js');
const HANDOFF = path.join(__dirname, '..', 'handoff.js');
const PRECOMPACT = path.join(__dirname, '..', 'pre-compact.js');
const CWD = 'C:\\Users\\grego\\Projets\\laststream';
const GENERIC = '/compact garde : issue en cours, branche et worktree, décisions, reste à faire, agents en cours';
const RAPPEL = '[Routage] Delegue selon CLAUDE.md (haiku-builder par defaut, gtko-agents:haiku-builder en mode plugin), parallelise au maximum (lots independants dans le meme message) ; plan/decision/review -> opus-advisor (gtko-agents:opus-advisor en mode plugin) ; modification de code -> skill livraison (gtko-agents:livraison en mode plugin), charge AVANT la premiere edition : issue Linear reprise ou creee puis In Progress, branche liee, tests et lint, review par un sous-agent, PR Fixes <ID>, CI verifiee apres chaque push par un gh pr checks dans un appel separe (jamais dans la meme commande ni le meme lot que le push), un refus de hook ne stoppe pas le process (appliquer son alternative), commentaires PR et Linear traites, In Review, jamais de merge.';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'compactage-'));
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

// Un tour de prompt : ecrit le transcript a ctx tokens, puis decide avec l'etat donne.
function turn(cfg, file, ctx, state, prompt = 'continue') {
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'salut' } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-y', usage: { input_tokens: ctx } } }),
  ].join('\n') + '\n');
  return decide({ session_id: 'sess-1', cwd: CWD, transcript_path: file, prompt }, cfg, state);
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

// Lance un hook en CLI ; MODEL_CHECK coupe l'avertissement de modele, HOME/USERPROFILE isoles.
function runHook(script, stdin, env) {
  return spawnSync(process.execPath, [script], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, MODEL_CHECK: 'off', ...env },
  });
}

function isolated(root) {
  return { HOME: root, USERPROFILE: root };
}

// ---------------------------------------------------------------- seuils context-budget

test('seuil passation : annonce une seule fois, plus rien aux tours suivants', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const file = path.join(root, 't.jsonl');
  let st = turn(cfg, file, 10000).state; // premier tour
  let r = turn(cfg, file, 310000, st); // passation
  assert.match(r.output, /^\[Budget contexte 310k \(seuil passation 300k\)\] Écris maintenant la passation/);
  st = r.state;
  for (const ctx of [320000, 350000, 360000]) {
    r = turn(cfg, file, ctx, st);
    assert.strictEqual(r.output, null, String(ctx));
    assert.strictEqual(r.json, null, String(ctx));
    st = r.state;
  }
});

test('blocage : un seul blocage, un seul avertissement, puis silence tant que le contexte reste haut', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const file = path.join(root, 't.jsonl');
  let st = turn(cfg, file, 10000).state;
  let r = turn(cfg, file, 410000, st);
  assert.strictEqual(r.json.decision, 'block');
  assert.strictEqual(r.output, null);
  st = r.state;
  r = turn(cfg, file, 420000, st);
  assert.strictEqual(r.json, null);
  assert.match(r.output, /^\[Budget contexte 420k \(seuil blocage 400k\)\] Contexte toujours/);
  st = r.state;
  for (const ctx of [430000, 440000, 460000]) {
    r = turn(cfg, file, ctx, st);
    assert.strictEqual(r.json, null, String(ctx));
    assert.strictEqual(r.output, null, String(ctx));
    st = r.state;
  }
  assert.strictEqual(st.level, 'warn');
  assert.strictEqual(st.blocked, true);
});

test('blocage puis demande de passation : consigne sans nouveau blocage, avertissement ensuite une fois', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const file = path.join(root, 't.jsonl');
  let st = turn(cfg, file, 10000).state;
  let r = turn(cfg, file, 410000, st); // blocage
  st = r.state;
  r = turn(cfg, file, 410000, st, 'écris la passation');
  assert.strictEqual(r.json, null);
  assert.match(r.output, /^\[Budget contexte 410k \(seuil passation 300k\)\] Écris maintenant la passation/);
  st = r.state;
  r = turn(cfg, file, 410500, st, 'suite');
  assert.strictEqual(r.json, null);
  assert.match(r.output, /Contexte toujours/);
  st = r.state;
  r = turn(cfg, file, 410600, st, 'suite');
  assert.strictEqual(r.json, null);
  assert.strictEqual(r.output, null);
});

test('seuil passation : ligne /compact tiree de la passation du projet, generique sans fichier', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const file = path.join(root, 't.jsonl');
  let st = turn(cfg, file, 10000).state;
  let r = turn(cfg, file, 310000, st);
  assert.ok(r.output.endsWith('\n' + GENERIC), 'sans passation : version generique');

  fs.mkdirSync(cfg.handoff.dir, { recursive: true });
  fs.writeFileSync(handoffPath(CWD, cfg), '## Tâche\nFinir le lot 2\n\n## Reste à faire\n- Tests\n');
  st = turn(cfg, file, 10000).state; // nouvel etat : meme seuil une seconde fois
  r = turn(cfg, file, 310000, st);
  assert.ok(r.output.endsWith('\n/compact garde : Tâche : Finir le lot 2 ; Reste : Tests'), r.output);
});

test('blocage : la raison propose la ligne /compact a coller', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const file = path.join(root, 't.jsonl');
  const st = turn(cfg, file, 10000).state;
  const r = turn(cfg, file, 410000, st);
  assert.match(r.json.reason, /\nOu, pour compacter en gardant le fil, colle cette ligne :\n/);
  assert.ok(r.json.reason.endsWith('\n' + GENERIC));
});

// ---------------------------------------------------------------- compactLine

const PASSATION = [
  '# Passation',
  '',
  '## titre',
  'Compactage guidé',
  '',
  '## Fait',
  '- context-budget : seuil une fois',
  '',
  '## Décisions',
  '- ne pas bloquer au PreCompact',
  '',
  '## Tâche',
  'Migrer les hooks vers le compactage guidé (ODY-135) : lot 2.',
  'Détail secondaire ignoré.',
  '',
  '## Issue Linear',
  'ODY-135',
  '',
  '## Branche/worktree',
  'feature/ody-135-compactage-guide (config-ody-135)',
  '',
  '## Reste à faire (étapes concrètes)',
  '1. Écrire pre-compact.js',
  '2. Tests du routeur',
  '- Mettre à jour SKILL.md',
  '',
  '<!-- precompact -->',
  '- Compactage (PreCompact) : 2026-10-21T10:00:00.000Z',
  '<!-- /precompact -->',
  '',
].join('\n');

test('compactLine : tache, issue, branche et reste depuis une passation, sur une ligne, bloc precompact ignore', () => {
  const line = compactLine(PASSATION);
  assert.ok(line.startsWith('/compact garde : Tâche : Migrer les hooks vers le compactage guidé (ODY-135) : lot 2.'), line);
  assert.ok(line.endsWith(' ; Issue : ODY-135 ; Branche : feature/ody-135-compactage-guide (config-ody-135) ; Reste : Écrire pre-compact.js ; Tests du routeur ; Mettre à jour SKILL.md'), line);
  assert.ok(!line.includes('\n'));
  assert.ok(!line.includes('Détail secondaire'));
  assert.ok(!line.includes('ne pas bloquer'));
  assert.ok(!line.includes('2026-10-21'));
});

test('compactLine : resume tronque a 300 caracteres, une seule ligne', () => {
  const items = Array.from({ length: 40 }, (_, i) => `- étape numéro ${i} à faire avec une description assez longue`).join('\n');
  const line = compactLine('## Reste à faire\n' + items + '\n');
  assert.ok(line.startsWith('/compact garde : Reste : étape numéro 0 à faire'), line);
  const summary = line.slice('/compact garde : '.length);
  assert.ok(summary.length <= 300, String(summary.length));
  assert.ok(summary.endsWith('…'));
  assert.ok(!line.includes('\n'));
});

test('compactLine : version generique sans passation utilisable', () => {
  assert.strictEqual(compactLine(null), GENERIC);
  assert.strictEqual(compactLine(''), GENERIC);
  assert.strictEqual(compactLine('texte libre sans section'), GENERIC);
  assert.strictEqual(compactLine('## Fait\n- rien\n'), GENERIC);
});

// ---------------------------------------------------------------- rappel [Routage]

test('routeur : une fois par session, puis a nouveau apres compactage ou /clear', () => {
  const root = tmpRoot();
  const env = isolated(root);
  const sid = 'rt-1';
  const prompt = JSON.stringify({ session_id: sid, cwd: CWD, prompt: 'x' });
  const state = path.join(root, '.claude', 'hook-state', 'router-' + sid + '.json');

  let r = runHook(ROUTER, prompt, env);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, RAPPEL);
  assert.ok(fs.existsSync(state));
  assert.strictEqual(runHook(ROUTER, prompt, env).stdout, '', 'deuxieme message : rien');

  runHook(HANDOFF, JSON.stringify({ session_id: sid, cwd: CWD, source: 'startup' }), env);
  assert.strictEqual(runHook(ROUTER, prompt, env).stdout, '', 'startup ne reinitialise pas');

  runHook(HANDOFF, JSON.stringify({ session_id: sid, cwd: CWD, source: 'compact' }), env);
  assert.strictEqual(runHook(ROUTER, prompt, env).stdout, RAPPEL, 'apres compact : reemis');
  assert.strictEqual(runHook(ROUTER, prompt, env).stdout, '');

  runHook(HANDOFF, JSON.stringify({ session_id: sid, cwd: CWD, source: 'clear' }), env);
  assert.strictEqual(runHook(ROUTER, prompt, env).stdout, RAPPEL, 'apres clear : reemis');
});

test('routeur : la remise a zero ne depend pas de HANDOFF=off', () => {
  const root = tmpRoot();
  const env = isolated(root);
  const prompt = JSON.stringify({ session_id: 'rt-2', prompt: 'x' });
  assert.strictEqual(runHook(ROUTER, prompt, env).stdout, RAPPEL);
  runHook(HANDOFF, JSON.stringify({ session_id: 'rt-2', cwd: CWD, source: 'compact' }), { ...env, HANDOFF: 'off' });
  assert.strictEqual(runHook(ROUTER, prompt, env).stdout, RAPPEL);
});

test('routeur : sans session_id, le rappel revient a chaque message', () => {
  const root = tmpRoot();
  const env = isolated(root);
  for (let i = 0; i < 2; i++) {
    assert.strictEqual(runHook(ROUTER, JSON.stringify({ prompt: 'x' }), env).stdout, RAPPEL);
  }
  assert.strictEqual(runHook(ROUTER, '', env).stdout, RAPPEL);
  assert.strictEqual(runHook(ROUTER, 'pas du json', env).stdout, RAPPEL);
});

// ---------------------------------------------------------------- pre-compact

// Transcript : 7 messages utilisateur, dont un resultat d'outil et un message de sous-agent a ignorer.
function transcriptFile(root) {
  const file = path.join(root, 't.jsonl');
  const user = (content) => JSON.stringify({ type: 'user', message: { role: 'user', content } });
  fs.writeFileSync(file, [
    user('m1 ancien'),
    user('m2 ancien'),
    user('trois-' + 'x'.repeat(300)),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-y', usage: { input_tokens: 10 }, content: [{ type: 'text', text: 'réponse' }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'sortie' }] } }),
    JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: 'sous-agent' } }),
    user('m4'),
    user('m5'),
    user('m6'),
    user('m7'),
  ].join('\n') + '\n');
  return file;
}

const FIXED = { now: new Date('2026-10-21T10:00:00.000Z'), branch: () => 'feature/x' };

test('pre-compact : cree la passation minimale quand elle est absente', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const tr = transcriptFile(root);
  const file = refreshPassation({ session_id: 's', cwd: CWD, transcript_path: tr, trigger: 'auto', custom_instructions: 'garde les tests' }, cfg, FIXED);
  assert.strictEqual(file, handoffPath(CWD, cfg));
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.startsWith('# Passation (automatique, PreCompact)\n'));
  assert.ok(text.includes('- Date : 2026-10-21T10:00:00.000Z\n'));
  assert.ok(text.includes('- Cwd : ' + CWD + '\n'));
  assert.ok(text.includes('- Branche : feature/x\n'));
  assert.ok(text.includes('- Déclencheur : auto\n'));
  assert.ok(text.includes('- Consignes de compactage : garde les tests\n'));
  const msgs = text.split('## Derniers messages utilisateur\n')[1].trimEnd().split('\n').map((l) => l.slice(2));
  assert.deepStrictEqual(msgs.slice(1), ['m4', 'm5', 'm6', 'm7']);
  assert.strictEqual(msgs[0].length, 200, 'message tronque a 200 caracteres');
  assert.ok(msgs[0].startsWith('trois-'));
  assert.ok(!text.includes('m1 ancien') && !text.includes('m2 ancien'), 'seuls les 5 derniers');
  assert.ok(!text.includes('sous-agent') && !text.includes('sortie'), 'sidechain et resultats d\'outil ignores');
});

test('pre-compact : passation existante, seul le bloc precompact est mis a jour, le reste est intact', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const tr = transcriptFile(root);
  const file = handoffPath(CWD, cfg);
  fs.mkdirSync(cfg.handoff.dir, { recursive: true });
  const original = '# Ma passation\n\n## Tâche\nLot 2\n\n## Reste à faire\n1. Finir le hook\n';
  fs.writeFileSync(file, original);
  const old = (Date.now() - 5 * 3600 * 1000) / 1000;
  fs.utimesSync(file, old, old);

  refreshPassation({ cwd: CWD, transcript_path: tr, trigger: 'manual' }, cfg, FIXED);
  let text = fs.readFileSync(file, 'utf8');
  assert.ok(text.startsWith(original + '\n<!-- precompact -->\n'), text);
  assert.ok(text.includes('- Déclencheur : manual\n'));
  assert.ok(!text.includes('- Consignes de compactage'));
  assert.ok(text.endsWith('<!-- /precompact -->\n'));
  assert.ok(fs.statSync(file).mtimeMs > Date.now() - 60 * 1000, 'date de modification rafraichie');

  refreshPassation({ cwd: CWD, transcript_path: tr, trigger: 'auto', custom_instructions: 'garde les tests' }, cfg, FIXED);
  text = fs.readFileSync(file, 'utf8');
  assert.strictEqual(text.split('<!-- precompact -->').length - 1, 1, 'un seul bloc');
  assert.ok(text.startsWith(original + '\n<!-- precompact -->\n'));
  assert.ok(text.includes('- Déclencheur : auto\n'));
  assert.ok(text.includes('- Consignes de compactage : garde les tests\n'));
  assert.ok(!text.includes('manual'));
  assert.ok(!text.includes('## Derniers messages'), 'passation existante non reecrite');
});

test('pre-compact : passation plus vieille que maxAgeHours mise de cote en .stale.md, passation minimale neuve', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const tr = transcriptFile(root);
  const file = handoffPath(CWD, cfg);
  const stale = file.replace(/\.md$/, '.stale.md');
  fs.mkdirSync(cfg.handoff.dir, { recursive: true });
  fs.writeFileSync(stale, 'ancien stale');
  const original = '# Ancienne passation\n\n## Reste à faire\n1. Vieux reste\n';
  fs.writeFileSync(file, original);
  const old = (Date.now() - 49 * 3600 * 1000) / 1000; // maxAgeHours vaut 48 dans makeConfig
  fs.utimesSync(file, old, old);

  refreshPassation({ cwd: CWD, transcript_path: tr, trigger: 'auto' }, cfg, FIXED);
  assert.strictEqual(fs.readFileSync(stale, 'utf8'), original, '.stale.md ecrase le precedent');
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.startsWith('# Passation (automatique, PreCompact)\n'), text);
  assert.ok(!text.includes('Vieux reste'));
  assert.ok(text.includes('- Déclencheur : auto\n'));
  assert.ok(text.includes('## Derniers messages utilisateur\n'));
  assert.ok(!text.includes('<!-- precompact -->'));
});

test('pre-compact : passation automatique precedente regeneree entierement, messages a jour', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const file = handoffPath(CWD, cfg);
  refreshPassation({ cwd: CWD, transcript_path: transcriptFile(root), trigger: 'manual' }, cfg, FIXED);
  assert.ok(fs.readFileSync(file, 'utf8').includes('- m4\n'));

  const tr2 = path.join(root, 't2.jsonl');
  fs.writeFileSync(tr2, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'nouveau-1' } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'nouveau-2' } }),
  ].join('\n') + '\n');
  refreshPassation({ cwd: CWD, transcript_path: tr2, trigger: 'auto' }, cfg, FIXED);
  const text = fs.readFileSync(file, 'utf8');
  assert.strictEqual(text.split('# Passation (automatique, PreCompact)').length - 1, 1, 'un seul en-tete');
  assert.ok(text.includes('- nouveau-1\n- nouveau-2\n'));
  assert.ok(!text.includes('- m4'), 'anciens messages retires');
  assert.ok(!text.includes('<!-- precompact -->'), 'pas de bloc ajoute a une passation automatique');
  assert.ok(text.includes('- Déclencheur : auto\n'));
});

test('pre-compact : marqueurs HTML retires des messages utilisateur recopies', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const tr = path.join(root, 't.jsonl');
  fs.writeFileSync(tr, JSON.stringify({ type: 'user', message: { role: 'user', content: 'avant <!-- precompact --> milieu --> fin' } }) + '\n');
  refreshPassation({ cwd: CWD, transcript_path: tr, trigger: 'auto' }, cfg, FIXED);
  const text = fs.readFileSync(handoffPath(CWD, cfg), 'utf8');
  assert.ok(text.includes('- avant precompact milieu fin\n'), text);
  assert.ok(!text.includes('<!--'));
  assert.ok(!text.includes('-->'));
});

test('pre-compact : HANDOFF=off ne cree ni ne modifie rien', () => {
  const root = tmpRoot();
  const cfg = makeConfig(root);
  const file = handoffPath(CWD, cfg);
  fs.mkdirSync(cfg.handoff.dir, { recursive: true });
  fs.writeFileSync(file, 'x');
  const other = handoffPath('C:\\autre', cfg);
  withEnv('HANDOFF', 'off', () => {
    assert.strictEqual(refreshPassation({ cwd: CWD, trigger: 'auto' }, cfg, FIXED), null);
    assert.strictEqual(refreshPassation({ cwd: 'C:\\autre', trigger: 'auto' }, cfg, FIXED), null);
  });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'x');
  assert.ok(!fs.existsSync(other));
});

test('pre-compact CLI : jamais de decision de blocage, exit 0, entree invalide comprise', () => {
  const root = tmpRoot();
  const env = isolated(root);
  const tr = transcriptFile(root);
  const cwd = path.join(root, 'projet-sans-git'); // dossier absent : branche 'inconnue'
  const r = runHook(PRECOMPACT, JSON.stringify({ session_id: 'pc', cwd, transcript_path: tr, trigger: 'manual' }), env);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
  const file = path.join(root, '.claude', 'handoffs', slug(cwd) + '.md');
  assert.ok(fs.existsSync(file));
  assert.ok(fs.readFileSync(file, 'utf8').includes('- Branche : inconnue\n'));
  for (const bad of ['', 'pas du json', '[]', 'null']) {
    const b = runHook(PRECOMPACT, bad, env);
    assert.strictEqual(b.status, 0, JSON.stringify(bad));
    assert.strictEqual(b.stdout, '', JSON.stringify(bad));
  }
});

test('pre-compact CLI : HANDOFF=off -> rien ecrit, sortie vide', () => {
  const root = tmpRoot();
  const cwd = path.join(root, 'projet-sans-git');
  const r = runHook(PRECOMPACT, JSON.stringify({ cwd, trigger: 'auto' }), { ...isolated(root), HANDOFF: 'off' });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
  assert.ok(!fs.existsSync(path.join(root, '.claude', 'handoffs', slug(cwd) + '.md')));
});
