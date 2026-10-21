'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { decide, decideFull } = require('../tool-guard.js');

const GUARD = path.join(__dirname, '..', 'tool-guard.js');
const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks-config.json'), 'utf8'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-guard-'));
const CWD = path.join(TMP, 'proj');
fs.mkdirSync(CWD);
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// Config injectee : etats dans le dossier temporaire, seuils de la config reelle.
const cfg = (toolGuard = {}) => ({ ...BASE, stateDir: TMP, toolGuard: { ...BASE.toolGuard, ...toolGuard } });
const C = cfg();
const WARN = "[tool-guard] 80 % du budget d'appels utilisé : termine, vérifie, commit et prépare ton rapport.";

let seq = 0;
const sid = () => 'sess-' + (++seq);
const inp = (session, name, tool_input, extra = {}) => ({ session_id: session, cwd: CWD, tool_name: name, tool_input, ...extra });
const bash = (session, command, extra) => inp(session, 'Bash', { command }, extra);
const SUB = (agent_type) => ({ agent_id: 'agent-1', agent_type });
const denied = (d, re) => {
  assert.ok(d, 'devait etre refuse');
  if (re) assert.match(d, re);
};
const allowed = (d) => assert.strictEqual(d, null);

// Fichier texte de 1000 lignes (plus de 20000 octets) pour les tests de taille.
const bigFile = (name, lines = 1000) => {
  const p = path.join(TMP, name);
  let s = '';
  for (let i = 1; i <= lines; i++) s += `ligne ${i} ${'x'.repeat(30)}\n`;
  fs.writeFileSync(p, s);
  return p;
};
const BIG = bigFile('big.txt');
fs.writeFileSync(path.join(TMP, 'small.txt'), 'a\nb\nc\n');

function run(stdin, env = {}) {
  const e = { ...process.env, HOME: TMP, USERPROFILE: TMP };
  delete e.TOOL_GUARD;
  delete e.DENY_LIST;
  // Configuration du poste de dev isolee : seul ce que le test passe dans env compte.
  delete e.CLAUDE_CONFIG_DIR;
  delete e.CLAUDE_PLUGIN_DATA;
  Object.assign(e, env);
  return spawnSync(process.execPath, [GUARD], { input: stdin, encoding: 'utf8', env: e });
}

test('budget : sous-agent haiku-builder bloque au-dela de son budget exact', () => {
  const s = sid();
  const max = BASE.toolGuard.budgets['haiku-builder'];
  for (let i = 0; i < max; i++) allowed(decide(bash(s, `echo ${i}`, SUB('haiku-builder')), C));
  denied(decide(bash(s, 'echo fin', SUB('haiku-builder')), C), /Budget d'outils atteint/);
});

test('budget : type exact prime sur la famille (haiku-builder au-dela du budget haiku)', () => {
  const s = sid();
  const sub = SUB('haiku-builder');
  for (let i = 0; i < BASE.toolGuard.budgets.haiku + 1; i++) allowed(decide(bash(s, `echo ${i}`, sub), C));
});

test('budget : type sans entree exacte -> budget de la famille haiku', () => {
  const s = sid();
  const sub = SUB('haiku-verify');
  const max = BASE.toolGuard.budgets.haiku;
  for (let i = 0; i < max; i++) allowed(decide(bash(s, `echo ${i}`, sub), C));
  denied(decide(bash(s, 'echo fin', sub), C), /Budget d'outils atteint/);
});

test('budget : type d agent inconnu -> budget default', () => {
  const s = sid();
  const max = BASE.toolGuard.budgets.default;
  for (let i = 0; i < max; i++) allowed(decide(bash(s, `echo ${i}`, SUB('autre-agent')), C));
  denied(decide(bash(s, 'echo fin', SUB('autre-agent')), C), /Budget d'outils atteint/);
});

// Mode plugin : les agents s'appellent "gtko-agents:<nom>" ; le prefixe est retire avant lookup.
// Budget de haiku-builder fixe a 3 (et non 60 = default, qui masquerait un lookup sans prefixe).
test('plugin : agent_type "gtko-agents:haiku-builder" recoit le meme budget que "haiku-builder"', () => {
  const c = cfg({ budgets: { ...BASE.toolGuard.budgets, 'haiku-builder': 3 } });
  for (const type of ['haiku-builder', 'gtko-agents:haiku-builder']) {
    const s = sid();
    const sub = SUB(type);
    for (let i = 0; i < 3; i++) allowed(decide(bash(s, `echo ${i}`, sub), c));
    denied(decide(bash(s, 'echo fin', sub), c), /Budget d'outils atteint/);
  }
});

test('plugin : budget exact et famille lus sans prefixe (gtko-agents:haiku-scout -> 40, gtko-agents:haiku-verify -> famille haiku)', () => {
  // Sans retrait du prefixe, ces deux types tomberaient sur le budget default (60).
  const cases = [
    ['gtko-agents:haiku-scout', BASE.toolGuard.budgets['haiku-scout']],
    ['gtko-agents:haiku-verify', BASE.toolGuard.budgets.haiku],
  ];
  for (const [type, max] of cases) {
    const s = sid();
    const sub = SUB(type);
    for (let i = 0; i < max; i++) allowed(decide(bash(s, `echo ${i}`, sub), C));
    denied(decide(bash(s, 'echo fin', sub), C), /Budget d'outils atteint/);
  }
});

test('budget : session principale (main) non bornee', () => {
  const s = sid();
  for (let i = 0; i < 40; i++) allowed(decide(bash(s, `echo ${i}`), C));
});

test('budget : grace apres depassement, seules les commandes git de finition passent', () => {
  const s = sid();
  const sub = SUB('haiku-builder');
  const max = BASE.toolGuard.budgets['haiku-builder'];
  for (let i = 0; i < max; i++) allowed(decide(bash(s, `echo ${i}`, sub), C));
  // budgetGrace = 6 : appels 61 a 66 ; au-dela (67) tout est refuse
  allowed(decide(bash(s, 'git status', sub), C));
  denied(decide(bash(s, 'git status && echo fin', sub), C), /Budget d'outils atteint/);
  allowed(decide(bash(s, 'git -C proj log -n 3', sub), C));
  allowed(decide(bash(s, 'git add . ; git commit -m "fin"', sub), C));
  allowed(decide(bash(s, 'git rev-parse HEAD', sub), C));
  allowed(decide(bash(s, 'git show HEAD', sub), C));
  denied(decide(bash(s, 'echo fin', sub), C), /Budget d'outils atteint/);
});

test('budget : avertissement a 80 % emis une seule fois, sans refus', () => {
  const s = sid();
  const sub = SUB('haiku-builder');
  const max = BASE.toolGuard.budgets['haiku-builder'];
  const warnings = [];
  for (let i = 1; i <= max; i++) {
    const r = decideFull(bash(s, `echo ${i}`, sub), C);
    assert.strictEqual(r.reason, null);
    if (r.context) {
      assert.strictEqual(r.context, WARN);
      warnings.push(i);
    }
  }
  assert.deepStrictEqual(warnings, [Math.ceil(max * BASE.toolGuard.budgetWarnAt)]);
});

test('CLI : au 80 % du budget, sortie additionalContext et pas de refus', () => {
  const s = sid();
  const dir = path.join(TMP, '.claude', 'hook-state');
  fs.mkdirSync(dir, { recursive: true });
  const max = BASE.toolGuard.budgets['haiku-builder'];
  const at = Math.ceil(max * BASE.toolGuard.budgetWarnAt);
  fs.writeFileSync(path.join(dir, `${s}__agent-1.json`), JSON.stringify({ count: at - 1, history: [], lastDenied: null }));
  const r = run(JSON.stringify(bash(s, 'echo ok', SUB('haiku-builder'))));
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(JSON.parse(r.stdout), {
    hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: WARN },
  });
});

test('anti-boucle : 3e appel identique refuse', () => {
  const s = sid();
  allowed(decide(bash(s, 'ls -la'), C));
  allowed(decide(bash(s, 'ls -la'), C));
  denied(decide(bash(s, 'ls -la'), C), /répété 3 fois/);
});

test('anti-boucle : une edition remet le compteur a zero', () => {
  const s = sid();
  const ls = () => bash(s, 'ls -la');
  allowed(decide(ls(), C));
  allowed(decide(ls(), C));
  denied(decide(ls(), C), /répété/);
  allowed(decide(inp(s, 'Edit', { file_path: path.join(CWD, 'a.js'), old_string: 'a', new_string: 'b' }), C));
  allowed(decide(ls(), C));
  allowed(decide(ls(), C));
  denied(decide(ls(), C), /répété/);
});

test('anti-boucle : seuls les appels identiques consecutifs comptent', () => {
  const s = sid();
  allowed(decide(bash(s, 'ls -la'), C));
  allowed(decide(bash(s, 'ls -la'), C));
  allowed(decide(bash(s, 'echo autre'), C));
  allowed(decide(bash(s, 'ls -la'), C));
  allowed(decide(bash(s, 'ls -la'), C));
  denied(decide(bash(s, 'ls -la'), C), /répété 3 fois/);
});

test('anti-boucle : blocage durable jusqu a un autre appel, message demande un autre appel', () => {
  const s = sid();
  allowed(decide(bash(s, 'ls -la'), C));
  allowed(decide(bash(s, 'ls -la'), C));
  denied(decide(bash(s, 'ls -la'), C), /Fais un autre appel \(ou modifie le code\) avant de relancer\./);
  denied(decide(bash(s, 'ls -la'), C), /répété/);
  allowed(decide(bash(s, 'echo ok'), C));
  allowed(decide(bash(s, 'ls -la'), C));
});

test('anti-boucle : appel refuse par un autre garde-fou ni compte ni ajoute a l historique', () => {
  const s = sid();
  allowed(decide(bash(s, 'ls -la'), C));
  allowed(decide(bash(s, 'ls -la'), C));
  denied(decide(inp(s, 'Read', { file_path: BIG }), C), /lu en entier/);
  denied(decide(bash(s, 'ls -la'), C), /répété/);
});

test('anti-boucle : outils d attente exclus, Task et Agent remettent l historique a zero', () => {
  const s = sid();
  for (let i = 0; i < 5; i++) allowed(decide(inp(s, 'TaskOutput', { task_id: 'x' }), C));
  for (let i = 0; i < 5; i++) allowed(decide(inp(s, 'Monitor', { command: 'x' }), C));
  allowed(decide(bash(s, 'ls -la'), C));
  allowed(decide(bash(s, 'ls -la'), C));
  allowed(decide(inp(s, 'TaskOutput', { task_id: 'x' }), C));
  denied(decide(bash(s, 'ls -la'), C), /répété/);
  allowed(decide(inp(s, 'Task', { prompt: 'p' }), C));
  allowed(decide(bash(s, 'ls -la'), C));
  allowed(decide(bash(s, 'ls -la'), C));
  denied(decide(bash(s, 'ls -la'), C), /répété/);
  allowed(decide(inp(s, 'Agent', { prompt: 'p' }), C));
  allowed(decide(bash(s, 'ls -la'), C));
  allowed(decide(bash(s, 'ls -la'), C));
  denied(decide(bash(s, 'ls -la'), C), /répété/);
});

test('hash : Bash et PowerShell ne hashent que la commande (description ignoree)', () => {
  const s = sid();
  allowed(decide(inp(s, 'PowerShell', { command: 'Get-Date', description: 'a' }), C));
  allowed(decide(inp(s, 'PowerShell', { command: 'Get-Date', description: 'b' }), C));
  denied(decide(inp(s, 'PowerShell', { command: 'Get-Date', description: 'c' }), C), /répété/);
  const b = sid();
  allowed(decide(bash(b, 'ls -la', { description: 'liste' }), C));
  allowed(decide(bash(b, 'ls -la', { description: 'autre' }), C));
  denied(decide(bash(b, 'ls -la', { description: 'encore' }), C), /répété/);
});

test('anti-boucle : le hash ignore l ordre des cles', () => {
  const s = sid();
  allowed(decide(inp(s, 'Bash', { command: 'ls -la', description: 'liste' }), C));
  allowed(decide(inp(s, 'Bash', { description: 'liste', command: 'ls -la' }), C));
  denied(decide(inp(s, 'Bash', { command: 'ls -la', description: 'liste' }), C), /répété/);
});

test('lecture entiere : fichier de 1000 lignes refuse en main', () => {
  const s = sid();
  denied(decide(inp(s, 'Read', { file_path: BIG }), C), /Fichier de 1000 lignes lu en entier/);
});

test('lecture entiere : seuil par famille (haiku 800 dans la config, releve a 2000)', () => {
  // Avec la config reelle (haiku 800), 1000 lignes sont refusees pour haiku.
  denied(decide(inp(sid(), 'Read', { file_path: BIG }, SUB('haiku-builder')), C), /1000 lignes/);
  const releve = cfg({ readMaxLines: { ...BASE.toolGuard.readMaxLines, haiku: 2000 } });
  allowed(decide(inp(sid(), 'Read', { file_path: BIG }, SUB('haiku-builder')), releve));
});

test('lecture par plage : offset/limit autorise, limit trop grand refuse', () => {
  const s = sid();
  allowed(decide(inp(s, 'Read', { file_path: BIG, offset: 100, limit: 200 }), C));
  denied(decide(inp(s, 'Read', { file_path: BIG, offset: 1, limit: 500 }), C), /Plage trop large/);
});

test('lecture par plage : offset sans limit compte la limite par defaut (2000)', () => {
  denied(decide(inp(sid(), 'Read', { file_path: BIG, offset: 100 }), C), /Plage trop large \(limit 2000/);
});

test('lecture : images, pdf, notebooks et fichier absent ignores', () => {
  const s = sid();
  for (const ext of ['.png', '.jpg', '.PDF', '.ipynb']) {
    const p = path.join(TMP, 'gros' + ext);
    fs.copyFileSync(BIG, p);
    allowed(decide(inp(s, 'Read', { file_path: p }), C));
  }
  allowed(decide(inp(s, 'Read', { file_path: path.join(TMP, 'absent.txt') }), C));
});

test('lecture : relance identique apres refus autorisee, un autre fichier non', () => {
  const s = sid();
  const big2 = bigFile('big2.txt');
  denied(decide(inp(s, 'Read', { file_path: BIG }), C), /lu en entier/);
  allowed(decide(inp(s, 'Read', { file_path: BIG }), C));
  denied(decide(inp(s, 'Read', { file_path: big2 }), C), /lu en entier/);
  allowed(decide(inp(s, 'Read', { file_path: big2 }), C));
});

test('recherche : Grep content large refuse en main, autorise sous sonnet et en files_with_matches', () => {
  const s = sid();
  denied(decide(inp(s, 'Grep', { pattern: 'foo', output_mode: 'content' }), C), /Recherche trop large/);
  allowed(decide(inp(sid(), 'Grep', { pattern: 'foo', output_mode: 'content' }, SUB('sonnet-builder')), C));
  allowed(decide(inp(s, 'Grep', { pattern: 'foo' }), C));
  allowed(decide(inp(s, 'Grep', { pattern: 'foo', output_mode: 'content', head_limit: 50 }), C));
  allowed(decide(inp(s, 'Grep', { pattern: 'foo', output_mode: 'content', glob: '*.js' }), C));
});

test('recherche : path racine du projet refuse, sous-dossier autorise', () => {
  const s = sid();
  denied(decide(inp(s, 'Grep', { pattern: 'foo', output_mode: 'content', path: CWD }), C), /Recherche trop large/);
  allowed(decide(inp(s, 'Grep', { pattern: 'foo', output_mode: 'content', path: path.join(CWD, 'src') }), C));
});

test('recherche : Glob de tout l arbre refuse en main', () => {
  const s = sid();
  denied(decide(inp(s, 'Glob', { pattern: '**/*' }), C), /Recherche trop large/);
  allowed(decide(inp(s, 'Glob', { pattern: 'src/**/*.js' }), C));
});

test('sorties : git log borne (-n, --max-count, --since, plage ; -C ignore ; guillemets masques)', () => {
  const s = sid();
  denied(decide(bash(s, 'git log'), C), /Sortie potentiellement énorme/);
  denied(decide(bash(s, 'git -C proj log'), C), /Sortie potentiellement/);
  denied(decide(bash(s, 'git log --format="%h | %s"'), C), /Sortie potentiellement/);
  allowed(decide(bash(s, 'git log -n 5'), C));
  allowed(decide(bash(s, 'git -C proj log -n 3'), C));
  allowed(decide(bash(s, 'git log --max-count=3'), C));
  allowed(decide(bash(s, 'git log --since=2026-01-01'), C));
  allowed(decide(bash(s, 'git log main..HEAD'), C));
  allowed(decide(bash(s, 'git log | head'), C));
});

test('sorties : commande de test sans reporter refusee, filtree autorisee', () => {
  const s = sid();
  denied(decide(bash(s, 'npm test'), C), /Sortie potentiellement/);
  allowed(decide(bash(s, 'npm test 2>&1 | tail -40'), C));
  allowed(decide(bash(s, 'npm test -- --reporter=dot'), C));
  allowed(decide(bash(s, 'npm test > out.log'), C));
  denied(decide(bash(s, 'npm test 2>&1'), C), /Sortie potentiellement/);
  denied(decide(bash(s, 'node --test'), C), /Sortie potentiellement/);
  allowed(decide(bash(s, 'node --test --test-reporter=dot claude/hooks/tests/'), C));
});

test('sorties : formes de test npm/pnpm/yarn/vitest/jest refusees sans cible ni quiet', () => {
  const s = sid();
  for (const c of ['pnpm test', 'yarn test', 'npm run test:unit', 'vitest run', 'jest']) {
    denied(decide(bash(s, c), C), /Sortie potentiellement/);
  }
});

test('sorties : dossier de tests entier = suite complete, refuse', () => {
  denied(decide(bash(sid(), 'node --test claude/hooks/tests/'), C));
});

test('sorties : tests avec fichier cible, quiet ou redirection stdout autorises', () => {
  const s = sid();
  for (const c of [
    'vitest run src/a.test.ts',
    'node --test claude/hooks/tests/tool-guard.test.js',
    'npm test -- --silent',
    'npm test -- -q',
    'npm test 1>out.txt',
    'npm test 2>&1 | head -5',
  ]) {
    allowed(decide(bash(s, c), C));
  }
});

test('sorties : tests - cd ne compte pas comme cible, 2> seul ne redirige pas, guillemets masques', () => {
  const s = sid();
  denied(decide(bash(s, 'cd /c/projet && npm test'), C), /Sortie potentiellement/);
  denied(decide(bash(s, 'npm test 2>out.txt'), C), /Sortie potentiellement/);
  denied(decide(bash(s, 'npm test "| head"'), C), /Sortie potentiellement/);
  allowed(decide(bash(s, 'echo "npm test"'), C));
});

test('sorties : cat et Get-Content sur gros fichier', () => {
  const s = sid();
  const at = { cwd: TMP };
  denied(decide(inp(s, 'Bash', { command: 'cat big.txt' }, at), C), /Sortie potentiellement/);
  allowed(decide(inp(s, 'Bash', { command: 'cat big.txt | head' }, at), C));
  allowed(decide(inp(s, 'PowerShell', { command: 'Get-Content big.txt -TotalCount 40' }, at), C));
  denied(decide(inp(s, 'PowerShell', { command: 'Get-Content big.txt' }, at), C), /Sortie potentiellement/);
  allowed(decide(inp(s, 'Bash', { command: 'cat small.txt' }, at), C));
});

test('perf : fichier de plus de 2 Mo refuse sans comptage (Read et cat)', () => {
  const huge = path.join(TMP, 'huge.txt');
  fs.writeFileSync(huge, Buffer.alloc(2 * 1024 * 1024 + 1, 0x0a));
  const s = sid();
  denied(decide(inp(s, 'Read', { file_path: huge }), C), /plus de 2 Mo/);
  denied(decide(inp(s, 'Bash', { command: `cat ${huge}` }, { cwd: TMP }), C), /Sortie potentiellement/);
});

test('etat : ecriture atomique (pas de .tmp restant) et JSON illisible -> etat neuf sans erreur', () => {
  const dir = path.join(TMP, 'atomic');
  const s = 'sess-atomic';
  const c = { ...C, stateDir: dir };
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${s}__main.json`);
  fs.writeFileSync(file, '{"count": 9');
  allowed(decide(bash(s, 'echo a'), c));
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).count, 1);
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});

test('TOOL_GUARD=off : aucune decision (CLI et in-process)', () => {
  const s = sid();
  denied(decide(bash(s, 'npm test'), C), /Sortie potentiellement/);
  const r = run(JSON.stringify(bash(s, 'npm test')), { TOOL_GUARD: 'off' });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
  process.env.TOOL_GUARD = 'off';
  try {
    allowed(decide(bash(sid(), 'npm test'), C));
  } finally {
    delete process.env.TOOL_GUARD;
  }
});

test('CLI : refus = JSON deny prefixe [tool-guard], etat ecrit dans stateDir, exit 0', () => {
  const r = run(JSON.stringify(bash(sid(), 'npm test')));
  assert.strictEqual(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /^\[tool-guard\] Sortie potentiellement/);
  assert.ok(fs.existsSync(path.join(TMP, '.claude', 'hook-state')), 'etat ecrit dans ~/.claude/hook-state (HOME simule)');
});

test('CLI : CLAUDE_CONFIG_DIR respecte : etat dans <CLAUDE_CONFIG_DIR>/hook-state, rien sous ~/.claude', () => {
  const home = path.join(TMP, 'home-cfgdir');
  const cfgDir = path.join(TMP, 'cfg-dir');
  const r = run(JSON.stringify(bash(sid(), 'echo ok')), { CLAUDE_CONFIG_DIR: cfgDir, HOME: home, USERPROFILE: home });
  assert.strictEqual(r.status, 0);
  assert.ok(fs.readdirSync(path.join(cfgDir, 'hook-state')).some((f) => f.endsWith('.json')), 'etat ecrit sous CLAUDE_CONFIG_DIR');
  assert.ok(!fs.existsSync(path.join(home, '.claude')), 'aucun dossier ~/.claude cree');
});

test('CLI : hooks-config.local.json (CLAUDE_PLUGIN_DATA) surcharge stateDir, chargement via lib/config.js', () => {
  const data = path.join(TMP, 'plugin-data');
  const localState = path.join(TMP, 'local-state');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'hooks-config.local.json'), JSON.stringify({ stateDir: localState }));
  const r = run(JSON.stringify(bash(sid(), 'echo ok')), { CLAUDE_PLUGIN_DATA: data });
  assert.strictEqual(r.status, 0);
  assert.ok(fs.readdirSync(localState).some((f) => f.endsWith('.json')), 'etat ecrit dans le stateDir du local');
});

test('CLI : autorise = sortie vide, exit 0', () => {
  const r = run(JSON.stringify(bash(sid(), 'echo ok')));
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

test('CLI : entree invalide -> fail-open', () => {
  for (const bad of ['', 'pas du json', '{"tool_name":', 'null', '[]']) {
    const r = run(bad);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  }
});

test('decide : entrees invalides -> pas de decision', () => {
  allowed(decide(null, C));
  allowed(decide('texte', C));
  allowed(decide({}, C));
  allowed(decide({ tool_name: 42 }, C));
});

test('nettoyage : etats plus vieux que stateMaxAgeHours supprimes au 20e appel', () => {
  const dir = path.join(TMP, 'cleanup');
  fs.mkdirSync(dir);
  const old = path.join(dir, 'vieux__main.json');
  fs.writeFileSync(old, '{}');
  const past = (Date.now() - 3 * 24 * 3600 * 1000) / 1000;
  fs.utimesSync(old, past, past);
  const recent = path.join(dir, 'recent__main.json');
  fs.writeFileSync(recent, '{}');
  const c = { ...C, stateDir: dir };
  const s = sid();
  for (let i = 0; i < 19; i++) allowed(decide(bash(s, `echo ${i}`), c));
  assert.ok(fs.existsSync(old), 'pas de nettoyage avant le 20e appel');
  allowed(decide(bash(s, 'echo 19'), c));
  assert.ok(!fs.existsSync(old), 'etat ancien supprime');
  assert.ok(fs.existsSync(recent), 'etat recent conserve');
});

test('nom de fichier d etat assaini', () => {
  const dir = path.join(TMP, 'names');
  allowed(decide(bash('a/b c', 'echo 1'), { ...C, stateDir: dir }));
  assert.ok(fs.existsSync(path.join(dir, 'a_b_c__main.json')));
});

// Commandes destructrices (toolGuard.denyCommands) : refusées, et les proches légitimes passent.
const DENY_MSG = /^commande destructrice refusée : .+\. (?:Alternative : .+\. )?Si c'est voulu, l'utilisateur la lance lui-même avec `! <commande>`\. Ne la contourne pas \(autre syntaxe, script, alias\) : demande à l'utilisateur\.$/;
const DENY = [
  'git push -f origin main',
  'git push --force origin master',
  'git push origin +main',
  'git push --force origin HEAD:refs/heads/main',
  'git push -fu origin feature/x:main',
  'git push origin --delete main',
  'git push --delete origin master',
  'git push origin :main',
  'git push origin :refs/heads/master',
  'git branch -D main',
  'git branch -D master',
  'git reset --hard origin/main',
  'git reset origin/master --hard',
  'git clean -fdx',
  'git clean -xdf',
  'git clean -f -d -x',
  'git -C ../autre clean -fdx',
  'git clean -fdx -e build',
  'rm -rf /',
  'rm -fr /',
  'rm -r -f /',
  'rm -rf /*',
  'rm -rf ~',
  'rm -rf ~/',
  'rm -rf $HOME',
  'rm -rf "$HOME"',
  'rm -rf C:\\',
  'rm -rf C:/',
  'rm -rf /c',
  'rm -rf /c/',
  'rm -rf /c/Users',
  'rm -rf C:/Users',
  'rm -rf .',
  'rm -rf ..',
  'rm -rf ./',
  'rm -rf *',
  'rm -Recurse -Force /c/Users',
  'Remove-Item -Recurse -Force C:\\',
  'Remove-Item -Recurse -Force C:\\Users',
  'ri -Recurse C:\\',
  'rd /s /q C:\\',
  'wrangler delete',
  'wrangler d1 delete mabase',
  'wrangler kv namespace delete --namespace-id x',
  'wrangler r2 bucket delete b',
  'wrangler queues delete q',
  'wrangler secret delete CLE',
  'npx wrangler d1 delete mabase',
  'gh repo delete owner/depot --yes',
  'gh release delete v1.0.0',
];
const ALLOW = [
  'git push',
  'git push -u origin feature/abc-1-x',
  'git push --force origin feature/abc-1-x',
  'git push --force-with-lease origin feature/abc-1-x',
  'git push origin +feature/abc-1-x',
  'git reset --hard HEAD~1',
  'git reset --hard origin/feature/x',
  'git branch -d feature/x',
  'git branch -D feature/main-fix',
  'git clean -fdx node_modules',
  'git clean -n',
  'rm -rf node_modules',
  'rm -rf ./dist',
  'rm -rf /tmp/build',
  'rm -rf /c/dev/tmp',
  'rm -rf ~/projets',
  'rm -rf .git-old',
  'rm -rf *.log',
  'Remove-Item -Recurse -Force .\\build',
  "Remove-Item -Recurse -Force 'C:\\dev\\x'",
  'wrangler deploy',
  'wrangler d1 execute mabase --command "select 1"',
  'gh pr create --title x',
  'gh release create v1.0.0',
  'gh repo view',
  'echo "git push --force"',
  'echo "rm -rf /"',
  "echo 'wrangler delete'",
  'git log -n 5',
  'npm test -- --reporter=dot',
  'git push -f origin fix/x',
  'Remove-Item -Force C:\\',
  'rm -rf ~/projets/*',
  'wrangler kv key delete CLE',
  'git commit -m "refus de rm -rf / ..." && bash scripts/bootstrap.sh status',
];

test('denyCommands : chaque motif est une regex valide avec une raison', () => {
  assert.ok(Array.isArray(BASE.toolGuard.denyCommands) && BASE.toolGuard.denyCommands.length > 0);
  for (const r of BASE.toolGuard.denyCommands) {
    assert.strictEqual(typeof r.reason, 'string');
    assert.doesNotThrow(() => new RegExp(r.pattern, 'i'));
  }
});

test('denyCommands : commandes destructrices refusées, message cite la règle', () => {
  for (const c of DENY) denied(decide(bash(sid(), c), C), DENY_MSG);
});

test('denyCommands : commandes proches légitimes passent', () => {
  for (const c of ALLOW) allowed(decide(bash(sid(), c), C));
});

test('denyCommands : chaque segment examiné (&&, ;, |, retour ligne, sous-shell, bash -c)', () => {
  for (const c of [
    'cd /x && git push --force',
    'ls ; rm -rf /',
    'ls | rm -rf ~',
    'echo ok\ngit push -f',
    'echo $(git push -f)',
    'echo a && wrangler delete',
    'bash -c "rm -rf /"',
    "powershell -Command 'Remove-Item -Recurse -Force C:\\'",
  ]) {
    denied(decide(bash(sid(), c, { cwd: REPO_MAIN }), C), DENY_MSG);
  }
});

test('denyCommands : refus non contournable (relance identique, sous-agent, boucle)', () => {
  const s = sid();
  for (let i = 0; i < 4; i++) denied(decide(bash(s, 'git push --force', { cwd: REPO_MAIN }), C), DENY_MSG);
  denied(decide(bash(sid(), 'rm -rf ~', SUB('haiku-builder')), C), DENY_MSG);
});

test('denyCommands : seul le champ command de Bash/PowerShell est examiné', () => {
  allowed(decide(bash(sid(), 'git status', { description: 'git push --force' }), C));
  allowed(decide(inp(sid(), 'Edit', { file_path: path.join(CWD, 'a.md'), old_string: 'a', new_string: 'rm -rf /' }), C));
  allowed(decide(inp(sid(), 'Write', { file_path: path.join(CWD, 'n.md'), content: 'git push --force' }), C));
});

test('denyCommands : DENY_LIST=off ne coupe que ce contrôle (in-process et CLI)', () => {
  process.env.DENY_LIST = 'off';
  try {
    allowed(decide(bash(sid(), 'git push --force origin main'), C));
    denied(decide(bash(sid(), 'npm test'), C), /Sortie potentiellement/);
  } finally {
    delete process.env.DENY_LIST;
  }
  denied(decide(bash(sid(), 'git push --force origin main'), C), DENY_MSG);
  const off = run(JSON.stringify(bash(sid(), 'wrangler delete')), { DENY_LIST: 'off' });
  assert.strictEqual(off.status, 0);
  assert.strictEqual(off.stdout, '');
});

test('denyCommands : TOOL_GUARD=off coupe aussi ce contrôle ; CLI refuse avec le message complet', () => {
  const r = run(JSON.stringify(bash(sid(), 'rm -rf ~')));
  assert.strictEqual(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /^\[tool-guard\] commande destructrice refusée : .+\. (?:Alternative : .+\. )?Si c'est voulu, l'utilisateur la lance lui-même avec `! <commande>`\. Ne la contourne pas \(autre syntaxe, script, alias\) : demande à l'utilisateur\.$/);
  const off = run(JSON.stringify(bash(sid(), 'rm -rf ~')), { TOOL_GUARD: 'off' });
  assert.strictEqual(off.status, 0);
  assert.strictEqual(off.stdout, '');
});

// Dépôts git réels (branche courante main et fix/x) dans le dossier temporaire.
function repo(name, branch) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir);
  const init = spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
  assert.strictEqual(init.status, 0, init.stderr);
  const head = spawnSync('git', ['-C', dir, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`], { encoding: 'utf8' });
  assert.strictEqual(head.status, 0, head.stderr);
  return dir;
}
const REPO_MAIN = repo('depot-main', 'main');
const REPO_FIX = repo('depot-fix', 'fix/x');

test('point 1 : texte de commit entre guillemets ne declenche pas le wrapper ; bash sans -c non examine', () => {
  allowed(decide(bash(sid(), 'git commit -m "refus de rm -rf / ..." && bash scripts/bootstrap.sh status', { cwd: REPO_MAIN }), C));
  denied(decide(bash(sid(), 'eval "rm -rf /"'), C), DENY_MSG);
  denied(decide(bash(sid(), 'bash -c "rm -rf /" && echo ok'), C), DENY_MSG);
});

test('point 2 : force sans cible sur la branche courante (main refuse ; fix/x et hors depot passent)', () => {
  for (const c of ['git push --force', 'git push -f', 'git push --force-with-lease', 'git push -f origin', 'git push -f origin HEAD']) {
    denied(decide(bash(sid(), c, { cwd: REPO_MAIN }), C), DENY_MSG);
    allowed(decide(bash(sid(), c, { cwd: REPO_FIX }), C));
    allowed(decide(bash(sid(), c), C));
  }
});

test('point 2 : cible explicite fix/x passe, meme depuis main ; main explicite refuse', () => {
  for (const c of ['git push --force-with-lease origin fix/x', 'git push -f origin fix/x', 'git push --force origin feature/abc-1-x']) {
    allowed(decide(bash(sid(), c, { cwd: REPO_MAIN }), C));
  }
  denied(decide(bash(sid(), 'git push --force-with-lease origin main', { cwd: REPO_FIX }), C), DENY_MSG);
});

test('point 2 : -C lu dans la commande pour la branche courante', () => {
  denied(decide(bash(sid(), `git -C "${REPO_MAIN}" push --force`), C), DENY_MSG);
  allowed(decide(bash(sid(), `git -C "${REPO_FIX}" push --force`, { cwd: REPO_MAIN }), C));
});

test('point 3 : corps de heredoc retires (donnee), sauf si un shell les execute', () => {
  allowed(decide(bash(sid(), "git commit -F - <<'EOF'\nfix: rm -rf /\ngit push --force\nEOF", { cwd: REPO_MAIN }), C));
  allowed(decide(bash(sid(), 'cat > notes.md <<EOF\nrm -rf ~\nEOF\necho ok'), C));
  denied(decide(bash(sid(), 'bash <<EOF\nrm -rf /\nEOF'), C), DENY_MSG);
  denied(decide(bash(sid(), 'sh -s <<X\ngit push -f origin main\nX', { cwd: REPO_FIX }), C), DENY_MSG);
  denied(decide(bash(sid(), 'git commit -m "use <<EOF"\nrm -rf /'), C), DENY_MSG);
});

test('point 4 : Remove-Item sans -Recurse (-Force seul) passe ; -r ou -Recurse sur une racine refuse', () => {
  allowed(decide(bash(sid(), 'Remove-Item -Force C:\\'), C));
  allowed(decide(bash(sid(), 'rm -Force /'), C));
  denied(decide(bash(sid(), 'Remove-Item -r -Force C:\\'), C), DENY_MSG);
  denied(decide(bash(sid(), 'Remove-Item -Recurse C:\\'), C), DENY_MSG);
});

test('point 5 : racine suivie de * refusee (~/*, $HOME/*, /c/*, C:\\*) ; sous-dossier avec * passe', () => {
  for (const c of ['rm -rf ~/*', 'rm -rf $HOME/*', 'rm -rf /c/*', 'rm -rf C:\\*']) denied(decide(bash(sid(), c), C), DENY_MSG);
  allowed(decide(bash(sid(), 'rm -rf ~/projets/*'), C));
});

test('point 6 : executable entre guillemets (chemin avec espaces), .exe, nom entre guillemets', () => {
  denied(decide(bash(sid(), '"C:\\Program Files\\Git\\cmd\\git.exe" push --force origin main'), C), DENY_MSG);
  denied(decide(bash(sid(), 'rm.exe -rf /'), C), DENY_MSG);
  denied(decide(bash(sid(), '"gh" repo delete owner/depot --yes'), C), DENY_MSG);
  denied(decide(bash(sid(), 'gh.exe release delete v1'), C), DENY_MSG);
  denied(decide(bash(sid(), '"wrangler" delete'), C), DENY_MSG);
  allowed(decide(bash(sid(), 'wrangler kv key delete CLE'), C));
  allowed(decide(bash(sid(), 'wrangler d1 execute mabase --command "DELETE FROM t"'), C));
});

// settings.json utilisateur : claude-home/ est hors plugin (absent du cache publie) : test ignore alors.
const USER_SETTINGS = path.join(__dirname, '..', '..', '..', 'claude-home', 'settings.json');

test('point 7 : settings.json deny : chaque regle Bash a son miroir PowerShell, variantes npx presentes', { skip: !fs.existsSync(USER_SETTINGS) && 'claude-home absent (hors plugin)' }, () => {
  const s = JSON.parse(fs.readFileSync(USER_SETTINGS, 'utf8'));
  const deny = s.permissions.deny;
  const bashRules = deny.filter((r) => r.startsWith('Bash('));
  assert.ok(bashRules.includes('Bash(npx wrangler delete:*)'));
  assert.ok(bashRules.includes('Bash(gh repo delete:*)'));
  for (const r of bashRules) assert.ok(deny.includes('PowerShell(' + r.slice('Bash('.length)), `miroir manquant pour ${r}`);
});

test('point 8 : message avec alternative (hint) et consigne de non-contournement', () => {
  denied(decide(bash(sid(), 'git reset --hard origin/main', { cwd: REPO_FIX }), C), /Alternative : git pull --ff-only\. Si c'est voulu/);
  denied(decide(bash(sid(), 'git reset --hard origin/main'), C), DENY_MSG);
});

test('point 9 : segment tronque a 16 Ko ; cible dans les premiers Ko vue, commande longue sans erreur', () => {
  const long = 'x'.repeat(40000);
  allowed(decide(bash(sid(), `echo ${long}`), C));
  denied(decide(bash(sid(), `rm -rf / ${long}`), C), DENY_MSG);
  denied(decide(bash(sid(), `echo ${long} && rm -rf /`), C), DENY_MSG);
});

// ABC-133, 2e review : heredoc arithmétique, guillemets échappés, alias @ de HEAD, doc wrangler.
test('ABC-133 N1 : décalage arithmétique $((1<<2)) n\'ouvre pas de heredoc ; la ligne suivante reste examinée', () => {
  denied(decide(bash(sid(), 'echo $((1<<2))\nrm -rf ~'), C), DENY_MSG);
  allowed(decide(bash(sid(), 'echo $((1<<2))\necho ok'), C));
  allowed(decide(bash(sid(), 'cat <<_fin\nrm -rf ~\n_fin\necho ok'), C));
  denied(decide(bash(sid(), 'cat <<EOF\nok\nEOF\nrm -rf ~'), C), DENY_MSG);
});

test('ABC-133 N2 : guillemets échappés dans bash -c / eval : la commande interne est examinée', () => {
  denied(decide(bash(sid(), 'bash -c "rm -rf \\"$HOME\\""'), C), DENY_MSG);
  denied(decide(bash(sid(), 'bash -c "rm -rf \\$HOME"'), C), DENY_MSG);
  denied(decide(bash(sid(), 'eval "rm -rf \\"/\\""'), C), DENY_MSG);
  allowed(decide(bash(sid(), 'bash -c "echo \\"ok\\""'), C));
});

test('ABC-133 N3 : @ (alias de HEAD) = branche courante : refusé sur main, passe sur fix/x', () => {
  for (const c of ['git push --force origin @', 'git push -f origin @', 'git push --force-with-lease origin @']) {
    denied(decide(bash(sid(), c, { cwd: REPO_MAIN }), C), DENY_MSG);
    allowed(decide(bash(sid(), c, { cwd: REPO_FIX }), C));
  }
  denied(decide(bash(sid(), `git -C "${REPO_MAIN}" push --force origin @`), C), DENY_MSG);
});

test('ABC-133 N5 : la règle wrangler documente les exclusions volontaires (kv key, r2 object, d1 execute)', () => {
  const r = BASE.toolGuard.denyCommands.find((x) => /wrangler/.test(x.pattern));
  assert.ok(r, 'règle wrangler introuvable');
  assert.match(r._note, /volontairement exclus/);
  for (const c of ['wrangler kv key delete', 'wrangler r2 object delete', 'wrangler d1 execute']) {
    assert.ok(r._note.includes(c), `exclusion absente de la doc : ${c}`);
  }
});

// ABC-133, 3e review : push forcé +@/+HEAD depuis main ; échappements hors wrapper (masquage, heredoc).
test('ABC-133 3e review : push forcé +@ et +HEAD depuis main refusés ; HEAD:feature/x autorisé', () => {
  for (const c of ['git push origin +@', 'git push origin +HEAD']) {
    denied(decide(bash(sid(), c, { cwd: REPO_MAIN }), C), DENY_MSG);
    allowed(decide(bash(sid(), c, { cwd: REPO_FIX }), C));
  }
  allowed(decide(bash(sid(), 'git push origin HEAD:feature/x', { cwd: REPO_MAIN }), C));
});

test('ABC-133 3e review : guillemets échappés hors wrapper examinés ; phrase entre guillemets et \\" dans une phrase autorisés', () => {
  denied(decide(bash(sid(), 'echo \\" ; rm -rf / ; echo \\"'), C), DENY_MSG);
  allowed(decide(bash(sid(), 'echo "rm -rf /"'), C));
  allowed(decide(bash(sid(), "echo 'a \\\" b'"), C));
  allowed(decide(bash(sid(), 'echo "a \\" rm -rf / ; echo b"'), C));
});

test('ABC-133 3e review : \\" dans une chaîne ne masque pas la suite ; \\< n\'ouvre pas de heredoc, \\\\<< en ouvre un', () => {
  denied(decide(bash(sid(), 'echo "a\\" <<X"\nrm -rf /\nX'), C), DENY_MSG);
  denied(decide(bash(sid(), 'echo \\<<EOF\nrm -rf /\nEOF'), C), DENY_MSG);
  allowed(decide(bash(sid(), 'echo \\\\<<EOF\nrm -rf /\nEOF'), C));
});

// ABC-133 : tokenisation des guillemets selon l'outil. PowerShell n'échappe pas avec \ (backtick, guillemets doublés).
const pw = (command, extra) => inp(sid(), 'PowerShell', { command }, extra);
test('ABC-133 PS : \\ ne protège pas le guillemet fermant en PowerShell ; Bash inchangé', () => {
  denied(decide(pw('cd "C:\\a b\\"; git push --force origin main; echo "ok"'), C), DENY_MSG);
  denied(decide(pw('Remove-Item "C:\\q y\\"; rm -rf /; echo "z"'), C), DENY_MSG);
  allowed(decide(bash(sid(), 'cd "C:\\a b\\"; git push --force origin main; echo "ok"'), C));
  allowed(decide(bash(sid(), 'Remove-Item "C:\\q y\\"; rm -rf /; echo "z"'), C));
});

test('ABC-133 PS : backtick et "" ne ferment pas une chaîne ; backtick hors chaîne n\'en ouvre pas', () => {
  allowed(decide(pw('echo "x `" ; rm -rf / ; y"'), C));
  allowed(decide(pw('echo "a "" ; rm -rf / ; ""b"'), C));
  allowed(decide(pw("echo 'it''s ; rm -rf / ; ok'"), C));
  denied(decide(pw('echo `"; rm -rf /; echo "x"'), C), DENY_MSG);
});

test('ABC-133 PS : guillemets typographiques (“ ” „ ‘ ’ ‚ ‛) ferment ou ouvrent une chaîne', () => {
  denied(decide(pw('echo "x” ; rm -rf / ; echo "y"'), C), DENY_MSG);
  denied(decide(pw("echo 'x’ ; rm -rf / ; echo 'y'"), C), DENY_MSG);
  denied(decide(pw('echo “x” ; rm -rf / ; echo “y”'), C), DENY_MSG);
  allowed(decide(pw('echo “x ; rm -rf / ; y”'), C));
});

test("ABC-133 PS : << n'ouvre pas de corps de heredoc (Bash seulement)", () => {
  denied(decide(pw('cat <<_fin\nrm -rf ~\n_fin\necho ok'), C), DENY_MSG);
  allowed(decide(bash(sid(), 'cat <<_fin\nrm -rf ~\n_fin\necho ok'), C));
});

test('ABC-133 PS : push forcé vers "@", "HEAD" ou \'@\' refusé depuis main, passe sur fix/x ; HEAD:feature/x passe', () => {
  for (const c of ['git push -f origin "@"', 'git push --force origin "HEAD"', "git push -f origin '@'"]) {
    denied(decide(pw(c, { cwd: REPO_MAIN }), C), DENY_MSG);
    denied(decide(bash(sid(), c, { cwd: REPO_MAIN }), C), DENY_MSG);
    allowed(decide(pw(c, { cwd: REPO_FIX }), C));
  }
  allowed(decide(bash(sid(), 'git push origin HEAD:feature/x', { cwd: REPO_MAIN }), C));
  allowed(decide(bash(sid(), 'git push origin "HEAD:feature/x"', { cwd: REPO_MAIN }), C));
});

// ABC-133 review : une chaîne entre guillemets doubles qui contient $( (ou un backtick en Bash) s'exécute : examinée.
test('ABC-133 review : "$(...)" et "`...`" entre guillemets doubles examinés (Bash et PowerShell)', () => {
  denied(decide(bash(sid(), 'echo "$(rm -rf ~) done"'), C), DENY_MSG);
  denied(decide(bash(sid(), 'echo "`rm -rf ~` done"'), C), DENY_MSG);
  denied(decide(pw('echo "$(Remove-Item -Recurse -Force C:\\) done"'), C), DENY_MSG);
  denied(decide(pw('echo “$(Remove-Item -Recurse -Force C:\\) done”'), C), DENY_MSG);
  // Non-régression : substitution sans commande dangereuse, guillemets simples, texte de commit.
  allowed(decide(bash(sid(), 'echo "$(git status) fini"'), C));
  allowed(decide(bash(sid(), "echo '$(rm -rf ~) done'"), C));
  allowed(decide(pw("echo '$(Remove-Item -Recurse -Force C:\\) done'"), C));
  allowed(decide(bash(sid(), 'git commit -m "fix: a b"', { cwd: REPO_MAIN }), C));
  allowed(decide(pw('git commit -m "fix: a b"', { cwd: REPO_MAIN }), C));
});

// ABC-133 review : powershell -Command "..." avec "" doublés : tout l'argument est examiné (le capture allait jusqu'au premier ").
test('ABC-133 review : powershell -Command "..." avec "" doublés examiné en entier (Bash et PowerShell)', () => {
  denied(decide(bash(sid(), 'powershell -Command "echo ""a b""; rm -rf ~"'), C), DENY_MSG);
  denied(decide(pw('powershell -Command "echo ""a b""; rm -rf ~"'), C), DENY_MSG);
  denied(decide(bash(sid(), 'bash -c "echo a"" ; rm -rf ~"'), C), DENY_MSG);
  allowed(decide(pw('powershell -Command "echo ""a b""; echo ok"'), C));
});

// ABC-133 review : guillemets entre le + et le refspec (+"HEAD", +'HEAD', +"@") : refusés depuis main.
test('ABC-133 review : push forcé +"HEAD", +\'HEAD\' et +"@" refusé depuis main, passe sur fix/x ; HEAD:feature/x passe', () => {
  for (const c of ['git push origin +"HEAD"', "git push origin +'HEAD'", 'git push origin +"@"']) {
    denied(decide(bash(sid(), c, { cwd: REPO_MAIN }), C), DENY_MSG);
    denied(decide(pw(c, { cwd: REPO_MAIN }), C), DENY_MSG);
    allowed(decide(bash(sid(), c, { cwd: REPO_FIX }), C));
  }
  allowed(decide(bash(sid(), 'git push origin HEAD:feature/x', { cwd: REPO_MAIN }), C));
});

// ABC-133 review : options avant -Command (-NoProfile, -ExecutionPolicy Bypass) et backtick échappé dans powershell -Command "...".
test('ABC-133 review : powershell avec options avant -Command refusé (Bash et PowerShell)', () => {
  denied(decide(bash(sid(), 'powershell -NoProfile -Command "Remove-Item -Recurse -Force C:\\Users"'), C), DENY_MSG);
  denied(decide(pw('powershell -NoProfile -Command "Remove-Item -Recurse -Force C:\\Users"'), C), DENY_MSG);
  denied(decide(bash(sid(), 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -Recurse ."'), C), DENY_MSG);
  denied(decide(pw('powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -Recurse ."'), C), DENY_MSG);
});

test('ABC-133 review : powershell -Command "echo `" ; Remove-Item ..." refusé : le backtick échappe le guillemet (PowerShell)', () => {
  denied(decide(pw('powershell -Command "echo `" ; Remove-Item -Recurse -Force C:\ "'), C), DENY_MSG);
});

test('ABC-133 review : powershell avec options et bash -c avec substitution sans danger autorisés', () => {
  allowed(decide(bash(sid(), 'powershell -NoProfile -Command "Get-ChildItem C:\Users"'), C));
  allowed(decide(pw('powershell -NoProfile -Command "Get-ChildItem C:\Users"'), C));
  allowed(decide(bash(sid(), 'bash -c "echo `date`"'), C));
});

test('ABC-133 review : 30 000 backticks sans guillemet fermant après powershell -Command " décidés en moins de 200 ms', () => {
  const cmd = 'powershell -Command "' + '`'.repeat(30000);
  for (const input of [bash(sid(), cmd), pw(cmd)]) {
    const t0 = performance.now();
    const d = decide(input, C);
    const ms = performance.now() - t0;
    assert.ok(ms < 200, `décision en ${ms.toFixed(1)} ms`);
    allowed(d);
  }
});

// ABC-156 : wrappers shell hors SHELL_ARG (& powershell, Start-Process -ArgumentList, cmd, chemin entre guillemets).
test('ABC-156 point 1 : & powershell / pwsh (positionnel ou entre apostrophes), cmd et chemin entre guillemets examinés', () => {
  denied(decide(bash(sid(), '& powershell "Remove-Item -Recurse -Force C:\\Users"'), C), DENY_MSG);
  denied(decide(pw("& pwsh 'Remove-Item -Recurse -Force C:\\Users'"), C), DENY_MSG);
  denied(decide(pw('& "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "Remove-Item -Recurse -Force C:\\Users"'), C), DENY_MSG);
  denied(decide(pw('cmd /c "rd /s /q C:\\Users"'), C), DENY_MSG);
  allowed(decide(pw('& powershell "Get-ChildItem C:\\Users"'), C));
  allowed(decide(pw('& "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "Get-Date"'), C));
});

test('ABC-156 point 1 : Start-Process -ArgumentList (chaîne, liste, cmd, ; dans la chaîne) examiné', () => {
  denied(decide(pw('Start-Process powershell -ArgumentList "-Command Remove-Item -Recurse -Force C:\\Users"'), C), DENY_MSG);
  denied(decide(pw("Start-Process pwsh -ArgumentList '-Command Remove-Item -Recurse -Force C:\\Users'"), C), DENY_MSG);
  denied(decide(pw('Start-Process powershell -ArgumentList "-NoProfile","-Command","Remove-Item -Recurse -Force C:\\Users"'), C), DENY_MSG);
  denied(decide(pw('Start-Process cmd -ArgumentList "/c rd /s /q C:\\Users"'), C), DENY_MSG);
  denied(decide(pw('Start-Process powershell -ArgumentList "-Command Get-Date; Remove-Item -Recurse -Force C:\\"'), C), DENY_MSG);
  allowed(decide(pw('Start-Process notepad -ArgumentList "D:\\data\\x.txt"'), C));
  allowed(decide(pw('Start-Process powershell -ArgumentList "-Command Get-Date"'), C));
});

// ABC-156 point 2 : dans powershell/pwsh, \ n'échappe rien ; cmd non plus. Bash garde \".
test('ABC-156 point 2 : powershell -Command "...C:\\" : le \\ ne protège pas le guillemet fermant (PowerShell, cmd)', () => {
  denied(decide(pw('powershell -Command "Remove-Item -Recurse -Force C:\\"'), C), DENY_MSG);
  denied(decide(bash(sid(), 'powershell -Command "Remove-Item -Recurse -Force C:\\"'), C), DENY_MSG);
  denied(decide(pw('pwsh -c "Remove-Item -Recurse -Force C:\\"; echo ok'), C), DENY_MSG);
  denied(decide(pw('cmd /c "rd /s /q C:\\"'), C), DENY_MSG);
  allowed(decide(pw('powershell -Command "Get-ChildItem C:\\"'), C));
});

// ABC-156 point 3 : dans bash, ` n'échappe pas le guillemet ; l'argument de sh -c se termine au premier ".
test('ABC-156 point 3 : bash, ` ne protège pas le guillemet ; PowerShell garde l échappement', () => {
  // ~"" n'est pas étendu par bash et rm reste collé au mot echo : sh reçoit « echo rm », rien ne tourne.
  allowed(decide(bash(sid(), 'sh -c "echo `x`"rm -rf ~""'), C));
  // Substitution ouverte dans une chaîne : la chaîne n'est pas masquée, rm reste examiné.
  denied(decide(bash(sid(), 'bash -c "echo `" ; rm -rf ~ ; echo "'), C), DENY_MSG);
  // PowerShell : `" est un guillemet échappé, la chaîne continue et sa suite est examinée.
  denied(decide(pw('powershell -Command "echo `" ; Remove-Item -Recurse -Force C:\\ "'), C), DENY_MSG);
});

// ABC-156 point 4 : la grâce de budget suit la tokenisation PowerShell (un " précédé de ` ne ferme pas la chaîne).
test('ABC-156 point 4 : grâce de budget PowerShell : wrangler deploy caché dans une fausse chaîne refusé, git status accepté', () => {
  const s = sid();
  const sub = (command) => inp(s, 'PowerShell', { command }, SUB('haiku-builder'));
  for (let i = 0; i < 60; i++) allowed(decide(sub('Get-Date ' + i), C));
  denied(decide(sub('git status `"; wrangler deploy; echo "x"'), C), /Budget d'outils atteint/);
  allowed(decide(sub('git status'), C));
});

test('ABC-156 : Start-Process -ArgumentList avec 15 000 paires `" non fermées décidé en moins de 200 ms', () => {
  const cmd = 'Start-Process powershell -ArgumentList ' + '`"'.repeat(15000);
  for (const input of [bash(sid(), cmd), pw(cmd)]) {
    const t0 = performance.now();
    decide(input, C);
    const ms = performance.now() - t0;
    assert.ok(ms < 200, `décision en ${ms.toFixed(1)} ms`);
  }
});

// ABC-158 point 1 : pwsh/powershell sans -Command n'est examiné que hors chaîne entre guillemets (faux positif sur un message de commit).
test('ABC-158 point 1 : pwsh positionnel dans un message de commit non refusé (Bash et PowerShell) ; hors chaîne entre guillemets, examiné', () => {
  const COMMIT = 'git commit -m "doc: pwsh \'Remove-Item -Recurse ~\' est refusé"';
  allowed(decide(bash(sid(), COMMIT), C));
  allowed(decide(pw(COMMIT), C));
  allowed(decide(bash(sid(), 'echo "pwsh \'Remove-Item -Recurse ~\'"'), C));
  allowed(decide(pw('echo "pwsh \'Remove-Item -Recurse ~\'"'), C));
  denied(decide(bash(sid(), 'echo pwsh \'Remove-Item -Recurse ~\''), C), DENY_MSG);
});

test('ABC-158 point 1 : pwsh positionnel refusé (début, &, ;, chemin entre guillemets, lanceurs, Bash et PowerShell)', () => {
  for (const c of [
    "pwsh 'Remove-Item -Recurse ~'",
    "& pwsh 'Remove-Item -Recurse ~'",
    'x; powershell "Remove-Item -Recurse ~"',
    '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" "Remove-Item -Recurse ~"',
    "sudo pwsh 'Remove-Item -Recurse ~'",
    "env FOO=1 pwsh 'Remove-Item -Recurse ~'",
    "x && timeout 5 nohup pwsh 'Remove-Item -Recurse ~'",
  ]) {
    denied(decide(bash(sid(), c), C), DENY_MSG);
    denied(decide(pw(c), C), DENY_MSG);
  }
});

test('ABC-158 point 1 : forme -Command (ou -c) toujours détectée partout, y compris dans un message', () => {
  denied(decide(bash(sid(), 'git commit -m "pwsh -Command \'Remove-Item -Recurse ~\'"'), C), DENY_MSG);
  denied(decide(pw('git commit -m "pwsh -c \'Remove-Item -Recurse ~\'"'), C), DENY_MSG);
});

// ABC-158 point 2 : options répétées avant un nom de shell (chaque nom ne doit plus relancer l'analyse jusqu'à la fin).
test('ABC-158 point 2 : "pwsh -a " et "bash -a " répétés 12 000 fois décidés en moins de 200 ms (Bash et PowerShell)', () => {
  for (const cmd of ['"' + 'pwsh -a '.repeat(12000), '"' + 'bash -a '.repeat(12000)]) {
    for (const input of [bash(sid(), cmd), pw(cmd)]) {
      const t0 = performance.now();
      decide(input, C);
      const ms = performance.now() - t0;
      assert.ok(ms < 200, `décision en ${ms.toFixed(1)} ms`);
    }
  }
});

// ABC-158 point 2 : un nom de shell en valeur d'option ouvre sa propre invocation, examinée à part.
test('ABC-158 point 2 : bash -o sh -c "rm -rf ~" refusé (l invocation sh -c est examinée)', () => {
  denied(decide(bash(sid(), 'bash -o sh -c "rm -rf ~"'), C), DENY_MSG);
});

// ABC-158 review : pwsh positionnel refusé hors chaîne entre guillemets, quelle que soit la position (12 formes, Bash et PowerShell).
const REVIEW_FORMS = [
  "{ powershell 'Remove-Item -Recurse ~'; }",
  "if ($x) { powershell 'Remove-Item -Recurse ~' }",
  "if true; then powershell 'Remove-Item -Recurse ~'; fi",
  "if ! true; then powershell 'Remove-Item -Recurse ~'; fi",
  "if true; do powershell 'Remove-Item -Recurse ~'; done",
  "if false; then :; else powershell 'Remove-Item -Recurse ~'; fi",
  "FOO=1 powershell 'Remove-Item -Recurse ~'",
  "sudo -u root powershell 'Remove-Item -Recurse ~'",
  "xargs powershell 'Remove-Item -Recurse ~'",
  "nice powershell 'Remove-Item -Recurse ~'",
  "& 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' 'Remove-Item -Recurse ~'",
  "{ powershell -com 'Remove-Item -Recurse ~'; }",
];
test('ABC-158 review : pwsh positionnel refusé partout hors chaîne (12 formes, Bash et PowerShell)', () => {
  for (const c of REVIEW_FORMS) {
    denied(decide(bash(sid(), c), C), DENY_MSG);
    denied(decide(pw(c), C), DENY_MSG);
  }
});

test('ABC-158 review : nom ou chemin entre guillemets, substitution "$(...)" et abréviations de -Command refusés (Bash et PowerShell)', () => {
  for (const c of [
    '"pwsh" \'Remove-Item -Recurse ~\'',
    "'C:\\Program Files\\PowerShell\\7\\pwsh.exe' 'Remove-Item -Recurse ~'",
    '"$(pwsh \'Remove-Item -Recurse ~\')"',
    'pwsh -co "Remove-Item -Recurse ~"',
    'pwsh -comman "Remove-Item -Recurse ~"',
    'pwsh -o pwsh -c "Remove-Item -Recurse ~"',
  ]) {
    denied(decide(bash(sid(), c), C), DENY_MSG);
    denied(decide(pw(c), C), DENY_MSG);
  }
});

test('ABC-158 review : texte entre guillemets, nom de shell accolé et message de commit non refusés (Bash et PowerShell)', () => {
  for (const c of [
    'echo "fix pwsh" "Remove-Item -Recurse ~"',
    'mypwsh \'Remove-Item -Recurse ~\'',
    'git commit -m "doc" -m \'pwsh "Remove-Item -Recurse ~"\'',
  ]) {
    allowed(decide(bash(sid(), c), C));
    allowed(decide(pw(c), C));
  }
});

// ABC-158 review : 'pwsh ' répété 12 000 fois aussi décidé en moins de 200 ms (comme les entrées du point 2).
test('ABC-158 review : "pwsh " répété 12 000 fois décidé en moins de 200 ms (Bash et PowerShell)', () => {
  for (const input of [bash(sid(), 'pwsh '.repeat(12000)), pw('pwsh '.repeat(12000))]) {
    const t0 = performance.now();
    decide(input, C);
    const ms = performance.now() - t0;
    assert.ok(ms < 200, `décision en ${ms.toFixed(1)} ms`);
  }
});

// ABC-158 : un guillemet dans un commentaire n'ouvre aucune chaîne qui cache la commande (Bash et PowerShell).
test("ABC-158 : pwsh caché derrière un commentaire à guillemet simple ou double refusé (Bash et PowerShell)", () => {
  for (const c of ["x # it's\npwsh 'Remove-Item -Recurse ~' # '", 'x # it"s\npwsh \'Remove-Item -Recurse ~\' # "']) {
    denied(decide(bash(sid(), c), C), DENY_MSG);
    denied(decide(pw(c), C), DENY_MSG);
  }
});

test("ABC-158 : pwsh après un commentaire <# #>, après une here-string @'...'@ (LF et CRLF) refusé (PowerShell)", () => {
  denied(decide(pw("x <# it's #> ; pwsh 'Remove-Item -Recurse ~' <# ' #>"), C), DENY_MSG);
  denied(decide(pw("$a = @'\nit's\n'@; pwsh 'Remove-Item -Recurse ~'; $b='"), C), DENY_MSG);
  denied(decide(pw("$a = @'\r\nit's\r\n'@\r\npwsh 'Remove-Item -Recurse ~'"), C), DENY_MSG);
});

test("ABC-158 : pwsh après $'\\'' (Bash) et $'pwsh' refusés, rm -rf ~ caché derrière $'\\'' refusé", () => {
  denied(decide(bash(sid(), "echo $'\\''; pwsh 'Remove-Item -Recurse ~'; echo $'\\''"), C), DENY_MSG);
  denied(decide(bash(sid(), "echo $'\\''; rm -rf ~; echo $'\\''"), C), DENY_MSG);
  denied(decide(bash(sid(), "$'pwsh' 'Remove-Item -Recurse ~'"), C), DENY_MSG);
});

test("ABC-158 : rm ou Remove-Item -Recurse ~ derrière un commentaire à guillemet refusés (Bash et PowerShell)", () => {
  denied(decide(bash(sid(), "x # it's\nrm -rf ~ # '"), C), DENY_MSG);
  denied(decide(pw("x # it's\nRemove-Item -Recurse ~ # '"), C), DENY_MSG);
});

test("ABC-158 : commentaires, here-strings et $'...' sans commande dangereuse non refusés (Bash et PowerShell)", () => {
  for (const c of ["echo ok # it's", 'git status # it"s', "echo $'a b'; git status"]) allowed(decide(bash(sid(), c), C));
  for (const c of ["Get-ChildItem # it's", "git status <# it's #>", "$a = @'\nit's\n'@"]) allowed(decide(pw(c), C));
});

// ABC-158 : 12 000 commentaires ou $' d'affilée, here-string non fermée (un seul masque), décidés en moins de 200 ms.
// Les here-strings PowerShell ne sont testées qu'en PowerShell : en Bash, "'\n" fait autant de paires '...' à masquer.
test("ABC-158 : commentaires, here-strings et $'...' répétés 12 000 fois décidés en moins de 200 ms (Bash et PowerShell)", () => {
  const timed = (input) => {
    const t0 = performance.now();
    decide(input, C);
    const ms = performance.now() - t0;
    assert.ok(ms < 200, `décision en ${ms.toFixed(1)} ms`);
  };
  for (const s of ['# '.repeat(12000), "x # it's\n".repeat(12000), "$'".repeat(12000), "$'" + 'a b '.repeat(4000) + "'"]) timed(bash(sid(), s));
  for (const s of ['# '.repeat(12000), "x # it's\n".repeat(12000), '<# '.repeat(12000), "@'\n".repeat(12000), "@'\n" + 'x '.repeat(6000) + "\n'@"]) timed(pw(s));
});

// ABC-158 review 3 : le parseur tient # après { ou = pour un commentaire ; a@' n'ouvre pas de here-string (A, B, C).
test("ABC-158 review 3 : pwsh caché par # après { ou =, ou par @' après un mot, refusé (PowerShell)", () => {
  denied(decide(pw("& {#'\npwsh 'Remove-Item -Recurse ~'\n#'\n}"), C), DENY_MSG);
  denied(decide(pw("$a=#'\npwsh 'Remove-Item -Recurse ~'\n#'"), C), DENY_MSG);
  denied(decide(pw("echo a@'\nx'; pwsh 'Remove-Item -Recurse ~'\n'@"), C), DENY_MSG);
});

// ABC-158 review 4 : en PowerShell, # commente aussi juste après la fin d'un jeton ('a'#, $a#, ]#, >#, 1#).
test("ABC-158 review 4 : pwsh caché par # collé à la fin d'un jeton, refusé (PowerShell)", () => {
  for (const pre of ["$a", "echo 'a'", 'echo "a"', 'echo ]', '$x[0]', 'echo a >x', '[int]1']) {
    denied(decide(pw(pre + "#'\npwsh 'Remove-Item -Recurse ~'\n#'"), C), DENY_MSG);
  }
  allowed(decide(pw('git commit -m "doc: pwsh \'Remove-Item -Recurse ~\' est refusé"'), C));
});

// ABC-158 review 3 : le masque guillemets seuls ne doit pas être quadratique (12 000 paires avec espaces, Bash et PowerShell).
test("ABC-158 review 3 : 12 000 paires de guillemets avec espaces décidées en moins de 200 ms (Bash et PowerShell)", () => {
  for (const s of ["'a b' ".repeat(12000), "'a\nb' ".repeat(12000)]) {
    for (const input of [bash(sid(), s), pw(s)]) {
      const t0 = performance.now();
      decide(input, C);
      const ms = performance.now() - t0;
      assert.ok(ms < 200, `décision en ${ms.toFixed(1)} ms`);
    }
  }
});

// ABC-162 : sauts de ligne suivis de guillemets (30 000 fois) et paires de guillemets avec espaces (24 000 fois),
// décidés en moins de 200 ms (Bash et PowerShell).
test('ABC-162 : "\\n\\"a" répété 30 000 fois et "\\"a b\\" " répété 24 000 fois décidés en moins de 200 ms (Bash et PowerShell)', () => {
  for (const s of ['\n"a'.repeat(30000), '"a b" '.repeat(24000)]) {
    for (const input of [bash(sid(), s), pw(s)]) {
      const t0 = performance.now();
      decide(input, C);
      const ms = performance.now() - t0;
      assert.ok(ms < 200, `décision en ${ms.toFixed(1)} ms`);
    }
  }
});
