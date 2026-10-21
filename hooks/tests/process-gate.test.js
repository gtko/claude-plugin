'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { decide, denyPayload } = require('../process-gate.js');

// Aucun test n'appelle le vrai git, gh ni le reseau : tout passe par fakeDeps().
const GATE = path.join(__dirname, '..', 'process-gate.js');
const CWD = '/work/repo';
const T0 = Date.parse('2026-10-20T12:00:00Z');
const MIN = 60 * 1000;
const KEY = 'FAKE_LINEAR_KEY_FOR_TEST';
const COMMIT_AT = '2026-10-20T10:00:00Z';
const REVIEW_AT = '2026-10-20T11:00:00Z';
const OLD_REVIEW_AT = '2026-10-20T09:00:00Z';

const ON_BRANCH = (name) => ({ 'git branch --show-current': { status: 0, stdout: name + '\n' } });
const FEATURE = ON_BRANCH('feature/ody-128-process-gate');
const MAIN_SYNCED = {
  ...ON_BRANCH('main'),
  'git fetch': { status: 0, stdout: '' },
  'git rev-parse HEAD': { status: 0, stdout: 'aaa1111\n' },
  'git rev-parse origin/main': { status: 0, stdout: 'aaa1111\n' },
};
const LINEAR_OK = { data: { issue: { identifier: 'ODY-128' } } };
const LINEAR_MISSING = { data: { issue: null } };
const LINEAR_NOT_FOUND = { errors: [{ message: 'Entity not found: Issue' }] };
const LINEAR_AUTH = { errors: [{ message: 'Authentication required' }] };
const LEGIT_ENV = { LINEAR_API_KEY: KEY };
const NO_LINEAR = {};

const shell = (command, tool_name = 'Bash') => ({ tool_name, tool_input: { command }, cwd: CWD });

// agentMerge: true par defaut ici : les tests de merge ci-dessous portent sur le controle de review et de checks ;
// le refus par defaut (merge reserve a l'humain) a ses propres tests (« merge reserve a l'humain »).
function cfgFor(t, processGate = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'process-gate-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { stateDir: dir, processGate: { agentMerge: true, ...processGate } };
}

// Faux git/gh/Linear. runs : prefixe de commande -> reponse (objet ou fonction(args, cwd)).
// Commande non prevue : statut 1 (echec), enregistree dans runCalls.
function fakeDeps({ env = LEGIT_ENV, runs = {}, linear = LINEAR_OK, runThrows = false, linearThrows = false } = {}) {
  const clock = { t: T0 };
  const runCalls = [];
  const linearCalls = [];
  return {
    env,
    clock,
    runCalls,
    linearCalls,
    now: () => clock.t,
    run(file, args, cwd, timeoutMs) {
      const sig = [file, ...args].join(' ');
      runCalls.push({ sig, cwd, timeoutMs });
      if (runThrows) throw new Error('echec simule');
      const k = Object.keys(runs).find((p) => sig.startsWith(p));
      if (k === undefined) return { status: 1, stdout: '' };
      return typeof runs[k] === 'function' ? runs[k](args, cwd) : runs[k];
    },
    async linear(apiKey, query, timeoutMs) {
      linearCalls.push({ apiKey, query, timeoutMs });
      if (linearThrows) throw new Error('timeout simule');
      return typeof linear === 'function' ? linear(query) : linear;
    },
  };
}

const noCalls = (d) => assert.strictEqual(d.runCalls.length + d.linearCalls.length, 0, 'aucun appel externe attendu');

const prView = (comments, commitDate = COMMIT_AT) => ({
  status: 0,
  stdout: JSON.stringify({ commits: [{ oid: 'abc', committedDate: commitDate }], comments, headRefName: 'feature/ody-128-process-gate' }),
});
const prChecks = (list) => ({ status: 0, stdout: JSON.stringify(list) });
const REVIEW_OK = [
  '<!-- review-4-axes -->',
  '### BUG\nAucun.',
  '### SECURITY\nOK.',
  '### UX/UI\nOK.',
  '### PERFORMANCE / COÛT\nOK.',
  '**Verdict : OK**',
].join('\n');

// --- Interrupteurs et commandes non concernees ---

test('interrupteur PROCESS_GATE=off : tout passe, aucun appel externe', async (t) => {
  const d = fakeDeps({ env: { PROCESS_GATE: 'off', LINEAR_API_KEY: KEY }, runs: ON_BRANCH('main') });
  assert.strictEqual(await decide(shell('git commit -m x'), cfgFor(t), d), null);
  assert.strictEqual(await decide(shell('gh pr create --title x'), cfgFor(t), d), null);
  assert.strictEqual(await decide(shell('wrangler deploy'), cfgFor(t), d), null);
  noCalls(d);
});

test('processGate.enabled=false : tout passe, aucun appel externe', async (t) => {
  const d = fakeDeps({ runs: ON_BRANCH('main') });
  assert.strictEqual(await decide(shell('git commit -m x'), cfgFor(t, { enabled: false }), d), null);
  noCalls(d);
});

test('commande non concernée : aucun appel externe', async (t) => {
  const cmds = ['ls -la', 'git status', 'git commit-tree abc -m x', 'echo "git commit"', 'npm run build', 'gh pr view 3', 'git log --oneline'];
  for (const c of cmds) {
    const d = fakeDeps({ runs: ON_BRANCH('main') });
    assert.strictEqual(await decide(shell(c), cfgFor(t), d), null, c);
    noCalls(d);
  }
  const d = fakeDeps({ runs: ON_BRANCH('main') });
  assert.strictEqual(await decide(shell('git commit -m x', 'Read'), cfgFor(t), d), null);
  noCalls(d);
});

// --- git commit ---

test('git commit sur main ou master : refus (Bash et PowerShell)', async (t) => {
  for (const branch of ['main', 'master']) {
    for (const tool of ['Bash', 'PowerShell']) {
      const d = fakeDeps({ runs: ON_BRANCH(branch) });
      const r = await decide(shell('git commit -m "ody-128 x"', tool), cfgFor(t), d);
      assert.match(r, /branche qui porte son identifiant/, branch + ' ' + tool);
      assert.match(r, /crée l'issue Linear/);
      assert.strictEqual(d.linearCalls.length, 0);
    }
  }
});

test('git commit sans clé d\'issue dans la branche, ou branche détachée : refus', async (t) => {
  for (const branch of ['feature/login', '']) {
    const d = fakeDeps({ runs: ON_BRANCH(branch) });
    const r = await decide(shell('git commit -m x'), cfgFor(t), d);
    assert.match(r, /crée l'issue Linear/, 'branche « ' + branch + ' »');
  }
});

test('git commit sur branche avec clé, sans LINEAR_API_KEY : passe sans appel Linear', async (t) => {
  for (const env of [NO_LINEAR, { LINEAR_API_KEY: '   ' }]) {
    const d = fakeDeps({ runs: FEATURE, env });
    assert.strictEqual(await decide(shell('git commit -m "x"'), cfgFor(t), d), null);
    assert.strictEqual(d.linearCalls.length, 0);
    assert.deepStrictEqual(d.runCalls.map((c) => c.sig), ['git branch --show-current']);
  }
});

test('git commit : issue trouvée dans Linear : passe, requête issue(id: "ODY-128")', async (t) => {
  const d = fakeDeps({ runs: FEATURE, linear: LINEAR_OK });
  assert.strictEqual(await decide(shell('git commit -m "x"'), cfgFor(t), d), null);
  assert.strictEqual(d.linearCalls.length, 1);
  assert.match(d.linearCalls[0].query, /issue\(id: "ODY-128"\) \{ identifier \}/);
  assert.strictEqual(d.linearCalls[0].apiKey, KEY);
});

test('git commit : issue absente de Linear : refus, sans fuite de la clé', async (t) => {
  const d = fakeDeps({ runs: FEATURE, linear: LINEAR_MISSING });
  const r = await decide(shell('git commit -m "x"'), cfgFor(t), d);
  assert.match(r, /n'existe pas dans Linear/);
  assert.ok(!r.includes(KEY));
});

test('Linear : erreur GraphQL « not found » : refus', async (t) => {
  const d = fakeDeps({ runs: FEATURE, linear: LINEAR_NOT_FOUND });
  assert.match(await decide(shell('git commit -m "x"'), cfgFor(t), d), /n'existe pas/);
});

test('Linear : erreur d\'authentification : fail-open', async (t) => {
  const d = fakeDeps({ runs: FEATURE, linear: LINEAR_AUTH });
  assert.strictEqual(await decide(shell('git commit -m "x"'), cfgFor(t), d), null);
});

test('Linear injoignable (exception ou timeout) : fail-open', async (t) => {
  const d = fakeDeps({ runs: FEATURE, linearThrows: true });
  assert.strictEqual(await decide(shell('git commit -m "x"'), cfgFor(t), d), null);
  assert.strictEqual(d.linearCalls.length, 1);
});

test('cache Linear : une requête par TTL, nouvelle vérification après expiration', async (t) => {
  const cfg = cfgFor(t, { linearCacheTtlMinutes: 60 });
  const d = fakeDeps({ runs: FEATURE, linear: LINEAR_OK });
  const cmd = shell('git commit -m "x"');
  assert.strictEqual(await decide(cmd, cfg, d), null);
  d.clock.t += 30 * MIN;
  assert.strictEqual(await decide(cmd, cfg, d), null);
  assert.strictEqual(d.linearCalls.length, 1, 'dans le TTL : pas de nouvel appel');
  d.clock.t += 31 * MIN;
  assert.strictEqual(await decide(cmd, cfg, d), null);
  assert.strictEqual(d.linearCalls.length, 2, 'TTL expiré : nouvel appel');
  const content = fs.readFileSync(path.join(cfg.stateDir, 'process-gate-linear-ODY-128.json'), 'utf8');
  assert.ok(!content.includes(KEY), 'la clé API ne doit pas être écrite dans le cache');
});

test('cache Linear : une issue absente n\'est pas mise en cache', async (t) => {
  const cfg = cfgFor(t);
  const d = fakeDeps({ runs: FEATURE, linear: LINEAR_MISSING });
  await decide(shell('git commit -m "x"'), cfg, d);
  await decide(shell('git commit -m "x"'), cfg, d);
  assert.strictEqual(d.linearCalls.length, 2);
});

test('git -C <dossier> commit : la branche est lue dans ce dossier', async (t) => {
  const d = fakeDeps({ runs: FEATURE, env: NO_LINEAR });
  await decide(shell('git -C ../autre commit -m x'), cfgFor(t), d);
  assert.strictEqual(d.runCalls[0].cwd, path.resolve(CWD, '../autre'));
});

// --- gh pr create ---

test('gh pr create : clé absente de --title et --body : refus', async (t) => {
  const d = fakeDeps({ runs: FEATURE, env: NO_LINEAR });
  const r = await decide(shell('gh pr create --title "Ajoute le gate" --body "texte"'), cfgFor(t), d);
  assert.match(r, /doit citer ODY-128 : mets la clé dans --title/);
});

test('gh pr create : clé seulement hors de --title/--body (autre option, autre commande) : refus', async (t) => {
  for (const cmd of [
    'gh pr create --title "rien" --body-file ody-128.md',
    'git checkout -b ody-128-x && gh pr create --title "rien"',
  ]) {
    const d = fakeDeps({ runs: FEATURE, env: NO_LINEAR });
    assert.match(await decide(shell(cmd), cfgFor(t), d), /citer ODY-128/, cmd);
  }
});

test('gh pr create : clé dans -t, --title, --title=, ou --body : passe', async (t) => {
  for (const cmd of [
    'gh pr create --title "ODY-128 Gate" --body "x"',
    'gh pr create -t "ody-128: gate" -b "x"',
    'gh pr create --title="ODY-128 gate"',
    'gh pr create --title "x" --body "Closes ODY-128"',
  ]) {
    const d = fakeDeps({ runs: FEATURE, env: NO_LINEAR });
    assert.strictEqual(await decide(shell(cmd), cfgFor(t), d), null, cmd);
  }
});

test('gh pr create : clé d\'une autre issue (ODY-1280 pour ody-128) : refus', async (t) => {
  const d = fakeDeps({ runs: FEATURE, env: NO_LINEAR });
  assert.match(await decide(shell('gh pr create --title "ODY-1280 gate"'), cfgFor(t), d), /citer ODY-128/);
});

test('gh pr create depuis main : refus', async (t) => {
  const d = fakeDeps({ runs: ON_BRANCH('main'), env: NO_LINEAR });
  assert.match(await decide(shell('gh pr create --title "ODY-128 x"'), cfgFor(t), d), /branche qui porte son identifiant/);
});

test('gh pr create : issue absente de Linear : refus', async (t) => {
  const d = fakeDeps({ runs: FEATURE, linear: LINEAR_MISSING });
  assert.match(await decide(shell('gh pr create --title "ODY-128 gate"'), cfgFor(t), d), /n'existe pas dans Linear/);
});

// --- gh pr merge ---

test('gh pr merge : aucune review : refus, checks non interrogés', async (t) => {
  const d = fakeDeps({ runs: { ...FEATURE, 'gh pr view': prView([]), 'gh pr checks': prChecks([]) }, env: NO_LINEAR });
  assert.match(await decide(shell('gh pr merge 42 --squash'), cfgFor(t), d), /review manquante ou périmée/);
  assert.ok(!d.runCalls.some((c) => c.sig.startsWith('gh pr checks')));
});

test('gh pr merge : review périmée, incomplète ou sans marqueur : refus', async (t) => {
  const variants = {
    'antérieure au dernier commit': [{ body: REVIEW_OK, createdAt: OLD_REVIEW_AT }],
    'section PERFORMANCE absente': [{ body: REVIEW_OK.replace('### PERFORMANCE / COÛT\nOK.', ''), createdAt: REVIEW_AT }],
    'verdict KO': [{ body: REVIEW_OK.replace('**Verdict : OK**', '**Verdict : À CORRIGER**'), createdAt: REVIEW_AT }],
    'sans marqueur': [{ body: REVIEW_OK.replace('<!-- review-4-axes -->', ''), createdAt: REVIEW_AT }],
  };
  for (const [name, comments] of Object.entries(variants)) {
    const d = fakeDeps({ runs: { ...FEATURE, 'gh pr view': prView(comments), 'gh pr checks': prChecks([]) }, env: NO_LINEAR });
    assert.match(await decide(shell('gh pr merge 42'), cfgFor(t), d), /review manquante ou périmée/, name);
  }
});

test('gh pr merge : review valide (Verdict: OK toléré), pas de check en échec : passe', async (t) => {
  for (const verdict of ['**Verdict : OK**', 'Verdict: OK']) {
    const body = REVIEW_OK.replace('**Verdict : OK**', verdict);
    const d = fakeDeps({ runs: { ...FEATURE, 'gh pr view': prView([{ body, createdAt: REVIEW_AT }]), 'gh pr checks': prChecks([]) }, env: NO_LINEAR });
    assert.strictEqual(await decide(shell('gh pr merge 42'), cfgFor(t), d), null, verdict);
  }
});

test('gh pr merge : checks en échec (bucket fail ou cancel) : refus avec leur liste', async (t) => {
  const checks = [
    { name: 'build', bucket: 'fail' },
    { name: 'lint', bucket: 'pass' },
    { name: 'e2e', bucket: 'cancel' },
  ];
  const d = fakeDeps({ runs: { ...FEATURE, 'gh pr view': prView([{ body: REVIEW_OK, createdAt: REVIEW_AT }]), 'gh pr checks': prChecks(checks) }, env: NO_LINEAR });
  const r = await decide(shell('gh pr merge 42'), cfgFor(t), d);
  assert.match(r, /build, e2e/);
  assert.doesNotMatch(r, /lint/);
});

test('gh pr merge : checks en attente (code 8, bucket pending), ignorés ; liste vide ou gh checks en échec : passe', async (t) => {
  const reviewed = (checks) => fakeDeps({ runs: { ...FEATURE, 'gh pr view': prView([{ body: REVIEW_OK, createdAt: REVIEW_AT }]), 'gh pr checks': checks }, env: NO_LINEAR });
  const pending = [{ name: 'deploy', bucket: 'pending' }, { name: 'lint', bucket: 'skipping' }, { name: 'unit', bucket: 'pass' }];
  assert.strictEqual(await decide(shell('gh pr merge 42'), cfgFor(t), reviewed({ status: 8, stdout: JSON.stringify(pending) })), null);
  assert.strictEqual(await decide(shell('gh pr merge 42'), cfgFor(t), reviewed(prChecks(pending))), null);
  assert.strictEqual(await decide(shell('gh pr merge 42'), cfgFor(t), reviewed(prChecks([]))), null);
  assert.strictEqual(await decide(shell('gh pr merge 42'), cfgFor(t), reviewed({ status: 1, stdout: '' })), null);
});

test('gh pr merge : numéro de PR et -R transmis à gh pr view / gh pr checks', async (t) => {
  const d = fakeDeps({ runs: { ...FEATURE, 'gh pr view': prView([{ body: REVIEW_OK, createdAt: REVIEW_AT }]), 'gh pr checks': prChecks([]) }, env: NO_LINEAR });
  assert.strictEqual(await decide(shell('gh pr merge 42 -R owner/repo --squash'), cfgFor(t), d), null);
  const sigs = d.runCalls.map((c) => c.sig);
  assert.ok(sigs.includes('gh pr view 42 -R owner/repo --json commits,comments,headRefName,additions,deletions,changedFiles,files,number,url'), sigs.join(' | '));
  assert.ok(sigs.includes('gh pr checks 42 -R owner/repo --json name,bucket'), sigs.join(' | '));
});

test('gh pr merge : gh pr view en échec : fail-open', async (t) => {
  const d = fakeDeps({ runs: { ...FEATURE, 'gh pr view': { status: 1, stdout: '' } }, env: NO_LINEAR });
  assert.strictEqual(await decide(shell('gh pr merge 42'), cfgFor(t), d), null);
});

// --- Voie rapide (ODY-130) : review rapide pour un petit diff hors chemins sensibles ---

const FAST_OK = ['<!-- review-rapide -->', '### Résumé\nPetit diff, rien à signaler.', 'Tests : node --test claude/hooks/tests/ : 0 échec', '**Verdict : OK**'].join('\n');
const FAST_KO = FAST_OK.replace('**Verdict : OK**', '**Verdict : À CORRIGER**');
const FAST_NO_TESTS = FAST_OK.replace(/^Tests.*\n/m, '');
// Vue complete de gh pr view : taille, fichiers, commentaires, numero et URL (petit diff par defaut).
const prFull = (comments, { additions = 10, deletions = 0, changedFiles = 1, files = [{ path: 'src/a.js' }] } = {}) => ({
  status: 0,
  stdout: JSON.stringify({ commits: [{ oid: 'abc', committedDate: COMMIT_AT }], comments, headRefName: 'feature/ody-128-process-gate', additions, deletions, changedFiles, files, number: 42, url: 'https://github.com/owner/repo/pull/42' }),
});
// Reponse de gh api (liste des fichiers). Par defaut : une entree par fichier de la vue, sans renommage.
const apiFiles = (entries) => ({ status: 0, stdout: JSON.stringify(entries) });
const apiOf = (view) => apiFiles(JSON.parse(view.stdout).files.map((f) => ({ filename: f.path, status: 'modified' })));
const fastRun = (view, checks = prChecks([]), api = apiOf(view)) => ({ ...FEATURE, 'gh pr view': view, 'gh pr checks': checks, 'gh api': api });
const GH_API_URL = 'gh api --hostname github.com repos/owner/repo/pulls/42/files?per_page=100';

test('voie rapide : petit diff hors chemins sensibles + review rapide fraîche OK : passe, checks vérifiés', async (t) => {
  const d = fakeDeps({ runs: fastRun(prFull([{ body: FAST_OK, createdAt: REVIEW_AT }])), env: NO_LINEAR });
  assert.strictEqual(await decide(shell('gh pr merge 42'), cfgFor(t), d), null);
  const sigs = d.runCalls.map((c) => c.sig);
  assert.ok(sigs.includes('gh pr view 42 --json commits,comments,headRefName,additions,deletions,changedFiles,files,number,url'), sigs.join(' | '));
  assert.ok(sigs.includes(GH_API_URL), sigs.join(' | '));
  assert.ok(sigs.includes('gh pr checks 42 --json name,bucket'), sigs.join(' | '));
});

test('voie rapide : 30 lignes passent, 31 refusées avec la taille', async (t) => {
  const view = (additions, deletions) => fakeDeps({ runs: fastRun(prFull([{ body: FAST_OK, createdAt: REVIEW_AT }], { additions, deletions })), env: NO_LINEAR });
  assert.strictEqual(await decide(shell('gh pr merge 42'), cfgFor(t), view(20, 10)), null);
  const r = await decide(shell('gh pr merge 42'), cfgFor(t), view(20, 11));
  assert.match(r, /31 lignes modifiées \(> 30\)/);
  assert.match(r, /poste une review 4 axes/);
});

test('voie rapide : chemin sensible (hooks, .env, workflows, CLAUDE.md, auth, wrangler) : refus nommant le fichier', async (t) => {
  for (const file of ['claude/hooks/x.js', 'config/.env.local', '.github/workflows/ci.yml', 'CLAUDE.md', 'src/Auth/login.js', 'wrangler.toml']) {
    const files = [{ path: 'src/a.js' }, { path: file }];
    const d = fakeDeps({ runs: fastRun(prFull([{ body: FAST_OK, createdAt: REVIEW_AT }], { files, changedFiles: 2 })), env: NO_LINEAR });
    const r = await decide(shell('gh pr merge 42'), cfgFor(t), d);
    assert.match(r, /voie rapide refusée : chemin sensible/, file);
    assert.ok(r.includes(file), file);
  }
});

test('voie rapide : files.length différent de changedFiles (liste tronquée) : refus', async (t) => {
  const d = fakeDeps({ runs: fastRun(prFull([{ body: FAST_OK, createdAt: REVIEW_AT }], { changedFiles: 3, files: [{ path: 'src/a.js' }] })), env: NO_LINEAR });
  assert.match(await decide(shell('gh pr merge 42'), cfgFor(t), d), /liste des fichiers incomplète/);
});

test('voie rapide : review rapide antérieure au dernier commit : refus, message mentionnant la review rapide', async (t) => {
  const d = fakeDeps({ runs: fastRun(prFull([{ body: FAST_OK, createdAt: OLD_REVIEW_AT }])), env: NO_LINEAR });
  const r = await decide(shell('gh pr merge 42'), cfgFor(t), d);
  assert.match(r, /review manquante ou périmée/);
  assert.match(r, /<!-- review-rapide -->/);
});

test('voie rapide : dernier verdict À CORRIGER (seul, ou OK puis KO plus récent) : refus', async (t) => {
  const variants = {
    'KO seul': [{ body: FAST_KO, createdAt: REVIEW_AT }],
    'OK puis KO': [{ body: FAST_OK, createdAt: REVIEW_AT }, { body: FAST_KO, createdAt: '2026-10-20T11:30:00Z' }],
  };
  for (const [name, comments] of Object.entries(variants)) {
    const d = fakeDeps({ runs: fastRun(prFull(comments)), env: NO_LINEAR });
    assert.match(await decide(shell('gh pr merge 42'), cfgFor(t), d), /review manquante ou périmée/, name);
  }
});

test('voie rapide : fastLane.enabled à false : review rapide refusée, message sans mention de la voie rapide', async (t) => {
  const d = fakeDeps({ runs: fastRun(prFull([{ body: FAST_OK, createdAt: REVIEW_AT }])), env: NO_LINEAR });
  const r = await decide(shell('gh pr merge 42'), cfgFor(t, { fastLane: { enabled: false } }), d);
  assert.match(r, /review manquante ou périmée/);
  assert.doesNotMatch(r, /review-rapide/);
});

test('voie rapide : champs gh absents (taille illisible) : refus fail-closed', async (t) => {
  const d = fakeDeps({ runs: { ...FEATURE, 'gh pr view': prView([{ body: FAST_OK, createdAt: REVIEW_AT }]), 'gh pr checks': prChecks([]) }, env: NO_LINEAR });
  assert.match(await decide(shell('gh pr merge 42'), cfgFor(t), d), /taille du diff illisible/);
});

test('voie rapide : motif invalide dans sensitivePaths : refus fail-closed', async (t) => {
  const d = fakeDeps({ runs: fastRun(prFull([{ body: FAST_OK, createdAt: REVIEW_AT }])), env: NO_LINEAR });
  assert.match(await decide(shell('gh pr merge 42'), cfgFor(t, { fastLane: { sensitivePaths: ['('] } }), d), /motif invalide dans fastLane.sensitivePaths/);
});

test('voie rapide : configuration partielle (maxLines seul) : sensitivePaths par défaut conservés', async (t) => {
  const cfg = cfgFor(t, { fastLane: { maxLines: 50 } });
  const sensible = fakeDeps({ runs: fastRun(prFull([{ body: FAST_OK, createdAt: REVIEW_AT }], { files: [{ path: 'claude/hooks/x.js' }] })), env: NO_LINEAR });
  assert.match(await decide(shell('gh pr merge 42'), cfg, sensible), /chemin sensible claude\/hooks\/x\.js/);
  const petit = fakeDeps({ runs: fastRun(prFull([{ body: FAST_OK, createdAt: REVIEW_AT }], { additions: 40 })), env: NO_LINEAR });
  assert.strictEqual(await decide(shell('gh pr merge 42'), cfg, petit), null);
});

test('voie rapide : checks en échec : refus avec leur liste', async (t) => {
  const d = fakeDeps({ runs: fastRun(prFull([{ body: FAST_OK, createdAt: REVIEW_AT }]), prChecks([{ name: 'build', bucket: 'fail' }])), env: NO_LINEAR });
  assert.match(await decide(shell('gh pr merge 42'), cfgFor(t), d), /checks en échec : build/);
});

test('review 4 axes fraîche + gros diff sensible : passe (comportement inchangé)', async (t) => {
  const view = prFull([{ body: REVIEW_OK, createdAt: REVIEW_AT }], {
    additions: 500,
    deletions: 120,
    changedFiles: 2,
    files: [{ path: 'claude/hooks/x.js' }, { path: 'src/b.js' }],
  });
  const d = fakeDeps({ runs: fastRun(view), env: NO_LINEAR });
  assert.strictEqual(await decide(shell('gh pr merge 42'), cfgFor(t), d), null);
});

test('voie rapide : diff de 200 lignes sans commentaire : REVIEW_MISSING avec la raison (pas REVIEW_MISSING_FAST), gh api non appelé', async (t) => {
  const d = fakeDeps({ runs: fastRun(prFull([], { additions: 150, deletions: 50 })), env: NO_LINEAR });
  const r = await decide(shell('gh pr merge 42'), cfgFor(t), d);
  assert.match(r, /^review manquante ou périmée : poste la review 4 axes/);
  assert.match(r, /200 lignes modifiées \(> 30\)/);
  assert.doesNotMatch(r, /peut passer avec une review rapide/);
  assert.ok(!d.runCalls.some((c) => c.sig.startsWith('gh api')), d.runCalls.map((c) => c.sig).join(' | '));
});

test('voie rapide : chemin sensible sans commentaire rapide : REVIEW_MISSING avec la raison (pas REVIEW_MISSING_FAST)', async (t) => {
  const d = fakeDeps({ runs: fastRun(prFull([], { files: [{ path: 'claude/hooks/x.js' }] })), env: NO_LINEAR });
  const r = await decide(shell('gh pr merge 42'), cfgFor(t), d);
  assert.match(r, /voie rapide refusée : chemin sensible claude\/hooks\/x\.js/);
  assert.doesNotMatch(r, /peut passer avec une review rapide/);
});

test('voie rapide : renommage pur hors chemin sensible (0 ligne) : refusé, ancien chemin lu via gh api', async (t) => {
  // gh pr view ne donne que le nouveau chemin ; l'ancien (previous_filename) vient de gh api.
  const view = prFull([{ body: FAST_OK, createdAt: REVIEW_AT }], { additions: 0, deletions: 0, files: [{ path: 'old/tool-guard.js' }] });
  const api = apiFiles([{ filename: 'old/tool-guard.js', previous_filename: 'claude/hooks/tool-guard.js', status: 'renamed', additions: 0, deletions: 0, changes: 0 }]);
  const d = fakeDeps({ runs: fastRun(view, prChecks([]), api), env: NO_LINEAR });
  const r = await decide(shell('gh pr merge 42'), cfgFor(t), d);
  assert.match(r, /review manquante ou périmée/);
  assert.match(r, /voie rapide refusée : chemin sensible claude\/hooks\/tool-guard\.js/);
  assert.ok(d.runCalls.some((c) => c.sig === GH_API_URL), d.runCalls.map((c) => c.sig).join(' | '));
});

test('voie rapide : fichier binaire (0 ligne comptée, pas un renommage) hors chemin sensible : refusé avec son chemin', async (t) => {
  const view = prFull([{ body: FAST_OK, createdAt: REVIEW_AT }], { additions: 0, deletions: 0, files: [{ path: 'assets/logo.png' }] });
  const api = apiFiles([{ filename: 'assets/logo.png', status: 'added', additions: 0, deletions: 0, changes: 0 }]);
  const d = fakeDeps({ runs: fastRun(view, prChecks([]), api), env: NO_LINEAR });
  const r = await decide(shell('gh pr merge 42'), cfgFor(t), d);
  assert.match(r, /review manquante ou périmée/);
  assert.match(r, /voie rapide refusée : fichier binaire ou sans ligne comptée : assets\/logo\.png : poste une review 4 axes/);
  assert.doesNotMatch(r, /peut passer avec une review rapide/);
  assert.ok(d.runCalls.some((c) => c.sig === GH_API_URL), d.runCalls.map((c) => c.sig).join(' | '));
});

test('voie rapide : renommage pur sans ligne comptée (status renamed, changes 0) hors chemin sensible : accepté', async (t) => {
  const view = prFull([{ body: FAST_OK, createdAt: REVIEW_AT }], { additions: 0, deletions: 0, files: [{ path: 'docs/new-name.md' }] });
  const api = apiFiles([{ filename: 'docs/new-name.md', previous_filename: 'docs/old-name.md', status: 'renamed', additions: 0, deletions: 0, changes: 0 }]);
  const d = fakeDeps({ runs: fastRun(view, prChecks([]), api), env: NO_LINEAR });
  assert.strictEqual(await decide(shell('gh pr merge 42'), cfgFor(t), d), null);
  assert.ok(d.runCalls.some((c) => c.sig === GH_API_URL), d.runCalls.map((c) => c.sig).join(' | '));
});

test('voie rapide : filename sensible seulement dans gh api (vue désaccordante) : refus', async (t) => {
  const api = apiFiles([{ filename: 'claude/hooks/x.js', status: 'added', additions: 1, deletions: 0 }]);
  const d = fakeDeps({ runs: fastRun(prFull([{ body: FAST_OK, createdAt: REVIEW_AT }]), prChecks([]), api), env: NO_LINEAR });
  assert.match(await decide(shell('gh pr merge 42'), cfgFor(t), d), /voie rapide refusée : chemin sensible claude\/hooks\/x\.js/);
});

test('voie rapide : gh api en échec, réponse illisible, nombre d\'entrées différent de changedFiles, PR sans URL : refus fail-closed', async (t) => {
  const ok = [{ body: FAST_OK, createdAt: REVIEW_AT }];
  const noUrl = JSON.parse(prFull(ok).stdout);
  delete noUrl.url;
  const cases = {
    'gh api en échec': [fastRun(prFull(ok), prChecks([]), { status: 1, stdout: '' }), /liste complète des fichiers indisponible/],
    'réponse illisible': [fastRun(prFull(ok), prChecks([]), { status: 0, stdout: '<html>' }), /liste complète des fichiers illisible/],
    'entrées ≠ changedFiles': [fastRun(prFull(ok, { changedFiles: 2, files: [{ path: 'src/a.js' }, { path: 'src/b.js' }] }), prChecks([]), apiFiles([{ filename: 'src/a.js' }])), /liste des fichiers incomplète/],
    'PR sans URL': [{ ...FEATURE, 'gh pr view': { status: 0, stdout: JSON.stringify(noUrl) }, 'gh pr checks': prChecks([]), 'gh api': apiFiles([{ filename: 'src/a.js' }]) }, /dépôt ou numéro de PR illisible/],
  };
  for (const [name, [runs, re]] of Object.entries(cases)) {
    const d = fakeDeps({ runs, env: NO_LINEAR });
    const r = await decide(shell('gh pr merge 42'), cfgFor(t), d);
    assert.match(r, re, name);
    assert.match(r, /voie rapide refusée/, name);
  }
});

test('voie rapide : package.json et .npmrc sont sensibles (une seule ligne suffit à refuser)', async (t) => {
  for (const file of ['package.json', 'apps/web/package.json', '.npmrc', 'config/.npmrc']) {
    const view = prFull([{ body: FAST_OK, createdAt: REVIEW_AT }], { additions: 1, deletions: 0, files: [{ path: file }] });
    const d = fakeDeps({ runs: fastRun(view), env: NO_LINEAR });
    const r = await decide(shell('gh pr merge 42'), cfgFor(t), d);
    assert.match(r, /voie rapide refusée : chemin sensible/, file);
    assert.ok(r.includes(file), file);
  }
});

test('hooks-config.json (fichier réel) : package.json et .npmrc figurent dans fastLane.sensitivePaths', async (t) => {
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks-config.json'), 'utf8'));
  real.processGate = { ...real.processGate, agentMerge: true };
  for (const file of ['package.json', '.npmrc']) {
    const view = prFull([{ body: FAST_OK, createdAt: REVIEW_AT }], { additions: 1, deletions: 0, files: [{ path: file }] });
    const d = fakeDeps({ runs: fastRun(view), env: NO_LINEAR });
    assert.match(await decide(shell('gh pr merge 42'), real, d), /voie rapide refusée : chemin sensible/, file);
  }
});

test('voie rapide : ligne « Tests : » obligatoire (absente, sans contenu, ou dans une autre ligne) : REVIEW_MISSING_FAST', async (t) => {
  const variants = {
    'sans ligne Tests': FAST_NO_TESTS,
    // Sans contenu : la ligne suivante (Verdict) ne doit pas compter comme resultat.
    'Tests : sans contenu': FAST_OK.replace(/^Tests :.*$/m, 'Tests :'),
    'Tests : en milieu de ligne': FAST_OK.replace(/^Tests :.*$/m, 'Résumé : Tests : OK'),
  };
  for (const [name, body] of Object.entries(variants)) {
    const d = fakeDeps({ runs: fastRun(prFull([{ body, createdAt: REVIEW_AT }])), env: NO_LINEAR });
    const r = await decide(shell('gh pr merge 42'), cfgFor(t), d);
    assert.match(r, /peut passer avec une review rapide/, name);
    assert.match(r, /ligne « Tests : ... »/, name);
  }
});

test('voie rapide : seule la review rapide la plus récente fait foi (sans ligne Tests : refusée même si une plus ancienne est valide)', async (t) => {
  const comments = [{ body: FAST_OK, createdAt: '2026-10-20T10:30:00Z' }, { body: FAST_NO_TESTS, createdAt: REVIEW_AT }];
  const d = fakeDeps({ runs: fastRun(prFull(comments)), env: NO_LINEAR });
  assert.match(await decide(shell('gh pr merge 42'), cfgFor(t), d), /peut passer avec une review rapide/);
});

// --- Deploiement ---

test('déploiement depuis une branche de feature : refus (wrangler deploy, deploy:worker)', async (t) => {
  for (const cmd of ['npx wrangler deploy --env prod', 'npm run deploy:worker']) {
    const d = fakeDeps({ runs: FEATURE });
    assert.match(await decide(shell(cmd), cfgFor(t), d), /déploie uniquement depuis main/, cmd);
    assert.deepStrictEqual(d.runCalls.map((c) => c.sig), ['git branch --show-current']);
  }
});

test('déploiement depuis main à jour (après git fetch -q origin main) : passe', async (t) => {
  const d = fakeDeps({ runs: MAIN_SYNCED });
  assert.strictEqual(await decide(shell('npm run deploy:worker'), cfgFor(t), d), null);
  assert.ok(d.runCalls.some((c) => c.sig === 'git fetch -q origin main'));
});

test('déploiement : HEAD différent de origin/main : refus', async (t) => {
  const runs = { ...MAIN_SYNCED, 'git rev-parse HEAD': { status: 0, stdout: 'bbb2222\n' } };
  const d = fakeDeps({ runs });
  assert.match(await decide(shell('wrangler deploy'), cfgFor(t), d), /origin\/main/);
});

test('déploiement : fetch en échec : fail-open', async (t) => {
  const d = fakeDeps({ runs: { ...ON_BRANCH('main'), 'git fetch': { status: 1, stdout: '' } } });
  assert.strictEqual(await decide(shell('wrangler deploy'), cfgFor(t), d), null);
  assert.ok(!d.runCalls.some((c) => c.sig.startsWith('git rev-parse')));
});

test('déploiement : patterns configurables ; commande sans rapport ignorée', async (t) => {
  const cfg = cfgFor(t, { deployPatterns: ['mon-deploy'] });
  const ignored = fakeDeps({ runs: FEATURE });
  assert.strictEqual(await decide(shell('npx wrangler deploy'), cfg, ignored), null);
  noCalls(ignored);
  const matched = fakeDeps({ runs: FEATURE });
  assert.match(await decide(shell('mon-deploy --prod'), cfg, matched), /déploie uniquement depuis main/);
});

// --- Dossier effectif (cd, Set-Location, pushd, /c/...) ---

const REPO_WIN = 'C:/Users/grego/Projets/config-ody-128';

test('dossier effectif : cd, Set-Location, Push-Location et chemin Git Bash /c/... sont suivis', async (t) => {
  const cases = [
    ['cd /c/Users/grego/Projets/config-ody-128 && git commit -m x', 'Bash'],
    ['cd /c/Users/grego/Projets && cd config-ody-128 && git commit -m x', 'Bash'],
    ['cd /c/Users/grego/Projets && git -C config-ody-128 commit -m x', 'Bash'],
    ['Set-Location C:\\Users\\grego\\Projets\\config-ody-128; git commit -m x', 'PowerShell'],
    ['Push-Location -Path "/c/Users/grego/Projets/config-ody-128"\ngit commit -m x', 'PowerShell'],
    ['(cd /c/Users/grego/Projets/config-ody-128 && git commit -m x)', 'Bash'],
  ];
  for (const [cmd, tool] of cases) {
    const d = fakeDeps({ runs: ON_BRANCH('main') });
    assert.match(await decide(shell(cmd, tool), cfgFor(t), d), /branche qui porte son identifiant/, cmd);
    assert.strictEqual(d.runCalls[0].cwd, path.win32.normalize(REPO_WIN), cmd);
  }
});

test('dossier effectif avec variable ou $( ) : fail-open, aucun appel externe', async (t) => {
  for (const cmd of [
    'cd "$HOME/projet" && git commit -m x',
    'Set-Location "$env:TEMP\\repo"; git commit -m x',
    'cd $(pwd) && git commit -m x',
    'git -C "$REPO" commit -m x',
  ]) {
    const d = fakeDeps({ runs: ON_BRANCH('main') });
    assert.strictEqual(await decide(shell(cmd), cfgFor(t), d), null, cmd);
    noCalls(d);
  }
});

// --- Sous-shells (...) : pile de dossiers, le cd ne déborde pas sur les segments suivants ---

const OTHER_WIN = path.win32.normalize('C:/Users/grego/Projets/autre');
const REPO_N = path.win32.normalize(REPO_WIN);
const FEATURE_NAME = 'feature/ody-128-process-gate';
// Branche courante selon le dossier d'appel (feature par defaut).
const branchBy = (byDir) => ({
  'git branch --show-current': (args, cwd) => ({ status: 0, stdout: (byDir[path.win32.normalize(cwd)] || FEATURE_NAME) + '\n' }),
});
const inRepo = (command) => ({ tool_name: 'Bash', tool_input: { command }, cwd: REPO_WIN });

test('sous-shell : (cd ../autre && git commit -m m) && gh pr create contrôle la PR dans le dossier de départ', async (t) => {
  const d = fakeDeps({ runs: branchBy({ [REPO_N]: 'main' }) });
  assert.match(await decide(inRepo('(cd ../autre && git commit -m m) && gh pr create'), cfgFor(t), d), /gh pr create refusé sur « main »/);
  assert.deepStrictEqual(d.runCalls.filter((c) => c.sig === 'git branch --show-current').map((c) => path.win32.normalize(c.cwd)), [OTHER_WIN, REPO_N]);
});

test('sous-shell : (cd ../autre && git commit -m m) contrôle le commit dans ../autre', async (t) => {
  const d = fakeDeps({ runs: branchBy({ [OTHER_WIN]: 'main' }) });
  assert.match(await decide(inRepo('(cd ../autre && git commit -m m)'), cfgFor(t), d), /commit refusé sur « main »/);
  assert.strictEqual(path.win32.normalize(d.runCalls[0].cwd), OTHER_WIN);
});

test('sous-shell : (cd ../autre) && gh pr merge 12 contrôle le merge dans le dossier de départ', async (t) => {
  const d = fakeDeps({ runs: { 'gh pr view': prView([]) } });
  assert.match(await decide(inRepo('(cd ../autre) && gh pr merge 12'), cfgFor(t), d), /review manquante ou périmée/);
  assert.strictEqual(path.win32.normalize(d.runCalls[0].cwd), REPO_N);
});

test('sous-shell : un $( ) dans le sous-shell ne le referme pas (le cd reste en vigueur)', async (t) => {
  const d = fakeDeps({ runs: branchBy({ [OTHER_WIN]: 'main' }) });
  assert.match(await decide(inRepo('(cd ../autre && echo $(date) && git commit -m m)'), cfgFor(t), d), /commit refusé sur « main »/);
  assert.strictEqual(path.win32.normalize(d.runCalls[0].cwd), OTHER_WIN);
});

// --- Prefixes de bloc ({, !, then, do, else, elif, bloc PowerShell) et pile pushd / popd ---

// Commit dans `dir` (branche main) : le refus doit venir de `dir`, pas du dossier de depart.
async function commitRefusedIn(t, command, dir, tool = 'Bash') {
  const d = fakeDeps({ runs: branchBy({ [dir]: 'main' }) });
  assert.match(await decide({ tool_name: tool, tool_input: { command }, cwd: REPO_WIN }, cfgFor(t), d), /commit refusé sur « main »/, command);
  assert.strictEqual(path.win32.normalize(d.runCalls[0].cwd), dir, command);
}

test('bloc { cd ../autre; git commit -m m; } : le commit est contrôlé dans ../autre', async (t) => {
  await commitRefusedIn(t, '{ cd ../autre; git commit -m m; }', OTHER_WIN);
});

test('prefixe ! : ! cd ../autre && git commit -m m contrôle le commit dans ../autre', async (t) => {
  await commitRefusedIn(t, '! cd ../autre && git commit -m m', OTHER_WIN);
});

// Bloc conditionnel (then, do, else, elif) : le cd peut ne pas avoir lieu, donc dossier inconnu (fail-open) :
// rien n'est controle et aucun appel externe. Toutes les branches sont sur main, donc un controle refuserait le commit.
async function unknownDirAfter(t, command, tool = 'Bash') {
  const d = fakeDeps({ runs: ON_BRANCH('main') });
  assert.strictEqual(await decide({ tool_name: tool, tool_input: { command }, cwd: REPO_WIN }, cfgFor(t), d), null, command);
  noCalls(d);
}

test('prefixe then : if true; then cd ../autre; fi; git commit -m m → dossier inconnu après le bloc', async (t) => {
  await unknownDirAfter(t, 'if true; then cd ../autre; fi; git commit -m m');
});

test('prefixe do : for d in 1; do cd ../autre; done; git commit -m m → dossier inconnu après la boucle', async (t) => {
  await unknownDirAfter(t, 'for d in 1; do cd ../autre; done; git commit -m m');
});

test('prefixe else : if false; then echo a; else cd ../autre; fi; git commit -m m → dossier inconnu', async (t) => {
  await unknownDirAfter(t, 'if false; then echo a; else cd ../autre; fi; git commit -m m');
});

test('prefixe elif : if false; then echo a; elif cd ../autre; then echo b; fi; git commit -m m → dossier inconnu', async (t) => {
  await unknownDirAfter(t, 'if false; then echo a; elif cd ../autre; then echo b; fi; git commit -m m');
});

test('bloc then sur plusieurs lignes : le cd de la ligne suivante est conditionnel → dossier inconnu', async (t) => {
  await unknownDirAfter(t, 'if true; then\ncd ../autre\nfi\ngit commit -m m');
});

test('cd dans le bloc then suivi d\'un commit dans le même bloc : dossier inconnu (le cd ne fait pas foi)', async (t) => {
  await unknownDirAfter(t, 'if true; then cd ../autre; git commit -m m; fi');
});

test('pushd conditionnel : pushd ../autre && if true; then popd; fi; git commit -m m → pile et dossier inconnus', async (t) => {
  await unknownDirAfter(t, 'pushd ../autre && if true; then popd; fi; git commit -m m');
});

test('then sans cd : if true; then echo a; fi; git commit -m m reste contrôlé dans le dossier de départ', async (t) => {
  await commitRefusedIn(t, 'if true; then echo a; fi; git commit -m m', REPO_N);
});

test('prefixe { : { cd ../autre; }; git commit -m m reste suivi après la fermeture du bloc', async (t) => {
  await commitRefusedIn(t, '{ cd ../autre; }; git commit -m m', OTHER_WIN);
});

// ODY-161 : un cd dans un bloc PowerShell (if ($ok) { ... }) est conditionnel, y compris pour le commit qui suit le bloc.
test('bloc PowerShell : if ($ok) { Set-Location ../autre; git commit -m m } → dossier inconnu (cd conditionnel)', async (t) => {
  await unknownDirAfter(t, 'if ($ok) { Set-Location ../autre; git commit -m m }', 'PowerShell');
});

test('bloc PowerShell ferme avant le commit : if ($ok) { Set-Location ../autre } ; git commit -m m → dossier inconnu', async (t) => {
  await unknownDirAfter(t, 'if ($ok) { Set-Location ../autre } ; git commit -m m', 'PowerShell');
});

test('pushd ../autre && git commit -m m : le commit est contrôlé dans ../autre', async (t) => {
  await commitRefusedIn(t, 'pushd ../autre && git commit -m m', OTHER_WIN);
});

test('Push-Location ../autre; git commit -m m (PowerShell) : le commit est contrôlé dans ../autre', async (t) => {
  await commitRefusedIn(t, 'Push-Location ../autre; git commit -m m', OTHER_WIN, 'PowerShell');
});

test('pushd ../autre && git commit -m m && popd && git commit -m n : popd revient au dossier de départ', async (t) => {
  const d = fakeDeps({ runs: branchBy({ [REPO_N]: 'main' }) });
  const input = { tool_name: 'Bash', tool_input: { command: 'pushd ../autre && git commit -m m && popd && git commit -m n' }, cwd: REPO_WIN };
  assert.match(await decide(input, cfgFor(t), d), /commit refusé sur « main »/);
  assert.deepStrictEqual(d.runCalls.filter((c) => c.sig === 'git branch --show-current').map((c) => path.win32.normalize(c.cwd)), [OTHER_WIN, REPO_N]);
});

test('Push-Location ../autre; git commit -m m; Pop-Location; git commit -m n (PowerShell) : Pop-Location revient au dossier de départ', async (t) => {
  const d = fakeDeps({ runs: branchBy({ [REPO_N]: 'main' }) });
  const input = { tool_name: 'PowerShell', tool_input: { command: 'Push-Location ../autre; git commit -m m; Pop-Location; git commit -m n' }, cwd: REPO_WIN };
  assert.match(await decide(input, cfgFor(t), d), /commit refusé sur « main »/);
  assert.deepStrictEqual(d.runCalls.filter((c) => c.sig === 'git branch --show-current').map((c) => path.win32.normalize(c.cwd)), [OTHER_WIN, REPO_N]);
});

test('pushd dans un sous-shell : (pushd ../autre); git commit -m m reste dans le dossier de départ', async (t) => {
  await commitRefusedIn(t, '(pushd ../autre); git commit -m m', REPO_N);
});

test('pile pushd/popd inconnue (popd sans pushd, pushd sans dossier) : fail-open, aucun appel externe', async (t) => {
  for (const [cmd, tool] of [
    ['popd && git commit -m m', 'Bash'],
    ['pushd && git commit -m m', 'Bash'],
    ['Pop-Location\ngit commit -m m', 'PowerShell'],
  ]) {
    const d = fakeDeps({ runs: ON_BRANCH('main') });
    assert.strictEqual(await decide(shell(cmd, tool), cfgFor(t), d), null, cmd);
    noCalls(d);
  }
});

// --- ODY-161 : changement de dossier conditionnel (bloc Bash en milieu de commande, && / ||, accolades PowerShell) ---

test('ODY-161 : cd dans un bloc if … fi suivi d\'un commit → dossier inconnu', async (t) => {
  await unknownDirAfter(t, 'if c; then echo a; cd ../x; fi; git commit -m "ody-1 x"');
});

test('ODY-161 : cd après un bloc if imbriqué (then if … fi) reste conditionnel → dossier inconnu', async (t) => {
  await unknownDirAfter(t, 'if c; then if d; then echo a; fi; cd ../x; fi; git commit -m m');
});

test('ODY-161 : groupe { … } après && ou || : le cd qu\'il contient est conditionnel → dossier inconnu', async (t) => {
  await unknownDirAfter(t, 'x && { y; cd ../x; }; git commit -m m');
  await unknownDirAfter(t, 'x || { cd ../x; }; git commit -m m');
  await unknownDirAfter(t, 'test -d r || { mkdir r; cd r; }; git commit -m m');
});

test('ODY-161 : cd ../autre && { git commit -m m; } contrôle le commit dans ../autre', async (t) => {
  const d = fakeDeps({ runs: branchBy({ [REPO_N]: 'main' }) });
  await decide(inRepo('cd ../autre && { git commit -m m; }'), cfgFor(t), d);
  assert.deepStrictEqual(d.runCalls.filter((c) => c.sig === 'git branch --show-current').map((c) => path.win32.normalize(c.cwd)), [OTHER_WIN]);
});

test('ODY-161 : false && cd ../x; git commit -m m → dossier inconnu', async (t) => {
  await unknownDirAfter(t, 'false && cd ../x; git commit -m m');
});

test('ODY-161 : x || cd ../x; git commit -m m → dossier inconnu', async (t) => {
  await unknownDirAfter(t, 'x || cd ../x; git commit -m m');
});

test('ODY-161 : cd ../autre || git commit -m m → dossier inconnu (le commit tourne si le cd a échoué)', async (t) => {
  await unknownDirAfter(t, 'cd ../autre || git commit -m m');
});

test('ODY-161 : if ($false) { Set-Location ../x }; git commit -m m (PowerShell) → dossier inconnu', async (t) => {
  await unknownDirAfter(t, 'if ($false) { Set-Location ../x }; git commit -m m', 'PowerShell');
});

test('ODY-161 : try { Set-Location ../x }; git commit -m m (PowerShell, bloc non reconnu) → dossier inconnu', async (t) => {
  await unknownDirAfter(t, 'try { Set-Location ../x }; git commit -m m', 'PowerShell');
});

test('ODY-161 : cd ../autre; git commit -m m (cd simple, non conditionnel) reste suivi', async (t) => {
  await commitRefusedIn(t, 'cd ../autre; git commit -m m', OTHER_WIN);
});

test('ODY-161 : après fi, un cd ../autre non conditionnel est suivi : if c; then echo a; fi; cd ../autre; git commit -m m', async (t) => {
  await commitRefusedIn(t, 'if c; then echo a; fi; cd ../autre; git commit -m m', OTHER_WIN);
});

// --- ODY-162 : replay des changements de dossier en une passe (pas de relecture du préfixe à chaque cd), < 200 ms ---

async function decidedFast(t, command) {
  const d = fakeDeps({ runs: ON_BRANCH('main') });
  const t0 = performance.now();
  await decide(shell(command), cfgFor(t), d);
  const ms = performance.now() - t0;
  assert.ok(ms < 200, `décision en ${ms.toFixed(1)} ms : ${command.slice(0, 30)}`);
}

test('ODY-162 : cd 20 000 fois d\'affilée décidé en moins de 200 ms', async (t) => {
  await decidedFast(t, 'cd a; '.repeat(20000) + 'git commit -m "x"');
});

test('ODY-162 : if … fi répété 10 000 fois décidé en moins de 200 ms', async (t) => {
  await decidedFast(t, 'if x; then cd a; fi; '.repeat(10000) + 'git commit -m "x"');
});

test('ODY-162 : then cd répété 20 000 fois décidé en moins de 200 ms', async (t) => {
  await decidedFast(t, 'then cd a; '.repeat(20000) + 'git commit -m "x"');
});

// --- Dépôts exclus (processGate.excludeRepos) ---

const LAUNCH = 'C:/Users/grego/Projets/laststream';
const CONTROLLED = 'C:/Users/grego/Projets/config-ody-128';
// Toplevel simule : le dossier lui-meme s'il est un sous-depot (sub-repo) ou le depot controle, sinon laststream.
const toplevel = (args, cwd) => ({ status: 0, stdout: (/(sub-repo|config-ody-128)$/.test(cwd) ? cwd : LAUNCH) + '\n' });

test('processGate.excludeRepos : commit sur main dans un dépôt exclu passe, sans autre appel', async (t) => {
  const d = fakeDeps({ runs: { ...ON_BRANCH('main'), 'git rev-parse --show-toplevel': toplevel } });
  assert.strictEqual(await decide(shell('git commit -m x'), cfgFor(t, { excludeRepos: [LAUNCH] }), d), null);
  assert.deepStrictEqual(d.runCalls.map((c) => c.sig), ['git rev-parse --show-toplevel']);
});

test('processGate.excludeRepos : casse et séparateurs ignorés', async (t) => {
  const d = fakeDeps({ runs: { ...ON_BRANCH('main'), 'git rev-parse --show-toplevel': toplevel } });
  assert.strictEqual(await decide(shell('git commit -m x'), cfgFor(t, { excludeRepos: ['c:\\users\\GREGO\\Projets\\laststream\\'] }), d), null);
  assert.ok(!d.runCalls.some((c) => c.sig === 'git branch --show-current'));
});

test('processGate.excludeRepos : sous-dépôt situé dans un dossier exclu reste contrôlé', async (t) => {
  const d = fakeDeps({ runs: { ...ON_BRANCH('main'), 'git rev-parse --show-toplevel': toplevel } });
  const input = { tool_name: 'Bash', tool_input: { command: 'cd sub-repo && git commit -m x' }, cwd: LAUNCH };
  assert.match(await decide(input, cfgFor(t, { excludeRepos: [LAUNCH] }), d), /branche qui porte son identifiant/);
});

test('processGate.excludeRepos : session dans laststream, git -C vers un dépôt contrôlé sur main : refus', async (t) => {
  const d = fakeDeps({ runs: { ...ON_BRANCH('main'), 'git rev-parse --show-toplevel': toplevel } });
  const input = { tool_name: 'Bash', tool_input: { command: `git -C ${CONTROLLED} commit -m x` }, cwd: LAUNCH };
  assert.match(await decide(input, cfgFor(t, { excludeRepos: [LAUNCH] }), d), /branche qui porte son identifiant/);
  assert.strictEqual(d.runCalls[0].cwd, path.win32.normalize(CONTROLLED));
});

test('processGate.excludeRepos : session dans un dépôt contrôlé, git -C vers laststream (exclu) : passe', async (t) => {
  const d = fakeDeps({ runs: { ...ON_BRANCH('main'), 'git rev-parse --show-toplevel': toplevel } });
  const input = { tool_name: 'Bash', tool_input: { command: `git -C ${LAUNCH} commit -m x` }, cwd: CONTROLLED };
  assert.strictEqual(await decide(input, cfgFor(t, { excludeRepos: [LAUNCH] }), d), null);
  assert.deepStrictEqual(d.runCalls.map((c) => c.sig), ['git rev-parse --show-toplevel']);
});

// --- Review : seul le commentaire marqué le plus récent compte ---

test('review : OK puis À CORRIGER plus récent : refus', async (t) => {
  const ko = REVIEW_OK.replace('**Verdict : OK**', '**Verdict : À CORRIGER**');
  const comments = [
    { body: REVIEW_OK, createdAt: REVIEW_AT },
    { body: ko, createdAt: '2026-10-20T11:30:00Z' },
  ];
  const d = fakeDeps({ runs: { ...FEATURE, 'gh pr view': prView(comments), 'gh pr checks': prChecks([]) }, env: NO_LINEAR });
  assert.match(await decide(shell('gh pr merge 42'), cfgFor(t), d), /review manquante ou périmée/);
});

test('review : « Verdict : OK » cité plus haut ne vaut pas si le dernier verdict est À CORRIGER', async (t) => {
  const body = [
    '<!-- review-4-axes -->',
    '### BUG\nLe brief disait Verdict : OK, c\'est faux.',
    '### SECURITY\nOK.',
    '### UX/UI\nOK.',
    '### PERFORMANCE / COÛT\nOK.',
    '**Verdict : À CORRIGER**',
  ].join('\n');
  const d = fakeDeps({ runs: { ...FEATURE, 'gh pr view': prView([{ body, createdAt: REVIEW_AT }]), 'gh pr checks': prChecks([]) }, env: NO_LINEAR });
  assert.match(await decide(shell('gh pr merge 42'), cfgFor(t), d), /review manquante ou périmée/);
});

test('review : un commentaire sans marqueur, plus récent, est ignoré', async (t) => {
  const comments = [
    { body: REVIEW_OK, createdAt: REVIEW_AT },
    { body: 'Verdict : À CORRIGER (discussion hors review)', createdAt: '2026-10-20T11:30:00Z' },
  ];
  const d = fakeDeps({ runs: { ...FEATURE, 'gh pr view': prView(comments), 'gh pr checks': prChecks([]) }, env: NO_LINEAR });
  assert.strictEqual(await decide(shell('gh pr merge 42'), cfgFor(t), d), null);
});

// --- gh pr create : --body-file, -F -, --fill ---

test('gh pr create : --body-file lu, -F - non inspecté, --fill vérifié sur le dernier commit', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'process-gate-body-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bodyFile = path.join(dir, 'body.md');
  fs.writeFileSync(bodyFile, 'Closes ODY-128\n');

  let d = fakeDeps({ runs: FEATURE, env: NO_LINEAR });
  assert.strictEqual(await decide(shell(`gh pr create --title "rien" --body-file "${bodyFile}"`), cfgFor(t), d), null);

  d = fakeDeps({ runs: FEATURE, env: NO_LINEAR });
  assert.match(await decide(shell('gh pr create --title "rien" -F -'), cfgFor(t), d), /doit citer ODY-128/);

  d = fakeDeps({ runs: FEATURE, env: NO_LINEAR });
  assert.strictEqual(await decide(shell('gh pr create --title "ODY-128 x" -F -'), cfgFor(t), d), null);

  d = fakeDeps({ runs: { ...FEATURE, 'git log -1 --format=%s': { status: 0, stdout: 'ODY-128 gate\n' } }, env: NO_LINEAR });
  assert.strictEqual(await decide(shell('gh pr create --fill'), cfgFor(t), d), null);

  d = fakeDeps({ runs: { ...FEATURE, 'git log -1 --format=%s': { status: 0, stdout: 'autre sujet\n' } }, env: NO_LINEAR });
  assert.match(await decide(shell('gh pr create --fill --title "x"'), cfgFor(t), d), /doit citer ODY-128/);

  d = fakeDeps({ runs: FEATURE, env: NO_LINEAR });
  assert.strictEqual(await decide(shell('gh pr create --title "rien" --body-file "$TMP/x.md"'), cfgFor(t), d), null, 'chemin variable : fail-open');
});

// --- git commit : options globales avant la sous-commande ---

test('git commit : options globales (-c, --no-pager, --git-dir=) reconnues ; git log ignoré', async (t) => {
  for (const cmd of ['git -c user.name=x commit -m y', 'git --no-pager commit -m y', 'git --git-dir=.git -c a=b commit -m y']) {
    const d = fakeDeps({ runs: ON_BRANCH('main') });
    assert.match(await decide(shell(cmd), cfgFor(t), d), /branche qui porte son identifiant/, cmd);
  }
  const d = fakeDeps({ runs: ON_BRANCH('main') });
  assert.strictEqual(await decide(shell('git --no-pager log'), cfgFor(t), d), null);
  noCalls(d);
});

// --- Déploiement : --dry-run et message dédié merge + déploiement ---

test('déploiement : --dry-run ne déclenche aucun contrôle', async (t) => {
  for (const cmd of ['wrangler deploy --dry-run', 'npm run deploy:worker -- --dry-run']) {
    const d = fakeDeps({ runs: FEATURE });
    assert.strictEqual(await decide(shell(cmd), cfgFor(t), d), null, cmd);
    noCalls(d);
  }
});

test('déploiement : --dry-run ne vaut que pour son segment', async (t) => {
  const d = fakeDeps({ runs: FEATURE });
  assert.match(await decide(shell('wrangler deploy --dry-run && wrangler deploy'), cfgFor(t), d), /déploie uniquement depuis main/);
  const ok = fakeDeps({ runs: FEATURE });
  assert.strictEqual(await decide(shell('wrangler deploy --dry-run && echo ok'), cfgFor(t), ok), null);
  noCalls(ok);
});

test('gh pr merge puis déploiement dans le même enchaînement : message dédié', async (t) => {
  const d = fakeDeps({ runs: { ...FEATURE, 'gh pr view': prView([{ body: REVIEW_OK, createdAt: REVIEW_AT }]), 'gh pr checks': prChecks([]) }, env: NO_LINEAR });
  const r = await decide(shell('gh pr merge 42 && npm run deploy:worker'), cfgFor(t), d);
  assert.match(r, /déploie uniquement depuis main/);
  assert.match(r, /lance le déploiement séparément, depuis main à jour/);
});

// --- Échéance globale et timeouts ---

test('timeouts : 8 s par appel, borné par le temps restant de l\'échéance de 15 s', async (t) => {
  const d = fakeDeps({ env: NO_LINEAR, runs: {
    ...FEATURE,
    'gh pr view': () => { d.clock.t += 9000; return prView([{ body: REVIEW_OK, createdAt: REVIEW_AT }]); },
    'gh pr checks': prChecks([]),
  } });
  assert.strictEqual(await decide(shell('gh pr merge 42'), cfgFor(t), d), null);
  assert.strictEqual(d.runCalls[0].timeoutMs, 8000);
  assert.strictEqual(d.runCalls[1].timeoutMs, 6000);
});

test('échéance : un contrôle lancé avant l\'échéance garde son refus, même si elle est dépassée pendant l\'appel', async (t) => {
  const d = fakeDeps({ env: NO_LINEAR, runs: {
    ...FEATURE,
    'gh pr view': () => { d.clock.t += 7000; return prView([{ body: REVIEW_OK, createdAt: REVIEW_AT }]); },
    'gh pr checks': () => { d.clock.t += 9000; return prChecks([{ name: 'build', bucket: 'fail' }]); },
  } });
  assert.match(await decide(shell('gh pr merge 42'), cfgFor(t), d), /checks en échec : build/);
});

test('échéance : un refus déjà calculé est conservé, le contrôle suivant n\'est pas lancé', async (t) => {
  const d = fakeDeps({ env: NO_LINEAR, runs: {
    ...FEATURE,
    'git branch --show-current': () => { d.clock.t += 16000; return { status: 0, stdout: 'main\n' }; },
    'gh pr view': prView([{ body: REVIEW_OK, createdAt: REVIEW_AT }]),
  } });
  assert.match(await decide(shell('git commit -m x && gh pr merge 42'), cfgFor(t), d), /branche qui porte son identifiant/);
  assert.ok(!d.runCalls.some((c) => c.sig.startsWith('gh pr view')));
});

test('échéance : dépassée avant un contrôle, celui-ci n\'est pas lancé', async (t) => {
  const d = fakeDeps({ env: NO_LINEAR, runs: {
    ...ON_BRANCH('main'),
    'gh pr view': () => { d.clock.t += 16000; return { status: 1, stdout: '' }; },
  } });
  assert.strictEqual(await decide(shell('gh pr merge 42 && git commit -m x'), cfgFor(t), d), null);
  assert.ok(!d.runCalls.some((c) => c.sig === 'git branch --show-current'));
});

test('échéance globale dépassée avant un appel : aucun appel de plus, fail-open', async (t) => {
  const d = fakeDeps({ env: NO_LINEAR, runs: {
    ...FEATURE,
    'gh pr view': () => { d.clock.t += 16000; return prView([{ body: REVIEW_OK, createdAt: REVIEW_AT }]); },
    'gh pr checks': prChecks([{ name: 'build', bucket: 'fail' }]),
  } });
  assert.strictEqual(await decide(shell('gh pr merge 42'), cfgFor(t), d), null);
  assert.ok(!d.runCalls.some((c) => c.sig.startsWith('gh pr checks')));
});

// --- Fail-open et format de sortie ---

test('exception pendant un appel externe : fail-open', async (t) => {
  const d = fakeDeps({ runs: ON_BRANCH('main'), runThrows: true });
  assert.strictEqual(await decide(shell('git commit -m x'), cfgFor(t), d), null);
});

test('entrée invalide : pas de décision', async (t) => {
  assert.strictEqual(await decide(null, cfgFor(t), fakeDeps()), null);
  assert.strictEqual(await decide('texte', cfgFor(t), fakeDeps()), null);
  assert.strictEqual(await decide({ tool_name: 'Bash' }, cfgFor(t), fakeDeps()), null);
});

test('refus : sortie deny au format des autres hooks, préfixe [process-gate]', () => {
  const p = denyPayload('x');
  assert.strictEqual(p.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.strictEqual(p.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(p.hookSpecificOutput.permissionDecisionReason, /^\[process-gate\] x$/);
});

// --- CLI : seulement les chemins qui n'atteignent ni git, ni gh, ni le reseau ---

function run(stdin, env = {}) {
  return spawnSync(process.execPath, [GATE], { input: stdin, encoding: 'utf8', env: { ...process.env, ...env } });
}

test('CLI : commande non concernée = sortie vide, exit 0', () => {
  const r = run(JSON.stringify(shell('ls -la')));
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

test('CLI : PROCESS_GATE=off sur git commit = sortie vide, exit 0', () => {
  const r = run(JSON.stringify(shell('git commit -m x')), { PROCESS_GATE: 'off' });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

test('CLI : entrée invalide -> fail-open', () => {
  for (const bad of ['', 'pas du json', '{"tool_name":', 'null', '[]']) {
    const r = run(bad);
    assert.strictEqual(r.status, 0, bad);
    assert.strictEqual(r.stdout, '', bad);
  }
});

// --- Merge reserve a l'humain et cle d'issue de toute equipe Linear ---

test('merge réservé à l\'humain : agentMerge absent ou false (défaut et fichier réel) : refus sans appel à gh', async (t) => {
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks-config.json'), 'utf8'));
  assert.strictEqual(real.processGate.agentMerge, false);
  const reviewed = prView([{ body: REVIEW_OK, createdAt: REVIEW_AT }]);
  for (const cfg of [{ processGate: {} }, { processGate: { agentMerge: false } }, real]) {
    const d = fakeDeps({ runs: { 'gh pr view': reviewed }, env: NO_LINEAR });
    const r = await decide(shell('gh pr merge 42 --squash'), cfg, d);
    assert.match(r, /merge réservé à l'humain/);
    // Ni gh pr view ni gh pr checks (le fichier réel peut lire le toplevel git pour excludeRepos).
    assert.deepStrictEqual(d.runCalls.filter((c) => c.sig.startsWith('gh ')), []);
  }
});

test('merge réservé à l\'humain : agentMerge « true » en texte ne vaut pas autorisation', async (t) => {
  const d = fakeDeps({ env: NO_LINEAR });
  assert.match(await decide(shell('gh pr merge 42'), { processGate: { agentMerge: 'true' } }, d), /merge réservé à l'humain/);
});

test('clé d\'issue par défaut : toute équipe Linear (BENCH-41, LOVER-7, A-1), convention <ID>-slug ou feature/<clé>-…', async (t) => {
  for (const branch of ['BENCH-41-webhooks-doublons', 'feature/lover-7-export', 'fix/A-1-x', 'feature/ody-128-process-gate']) {
    const d = fakeDeps({ runs: ON_BRANCH(branch), env: NO_LINEAR });
    assert.strictEqual(await decide(shell('git commit -m x'), { processGate: {} }, d), null, branch);
  }
  for (const branch of ['feature/export-csv', 'main', 'bench41-x']) {
    const d = fakeDeps({ runs: ON_BRANCH(branch), env: NO_LINEAR });
    assert.match(await decide(shell('git commit -m x'), { processGate: {} }, d), /refusé/, branch);
  }
});

test('gh pr create : la clé de la branche (BENCH-41) doit figurer dans le titre ou le corps', async (t) => {
  const d = fakeDeps({ runs: ON_BRANCH('BENCH-41-webhooks'), env: NO_LINEAR });
  assert.strictEqual(await decide(shell('gh pr create --title "fix(payments): doublons (BENCH-41)" --body "x"'), { processGate: {} }, d), null);
  assert.match(await decide(shell('gh pr create --title "fix" --body "BENCH-410"'), { processGate: {} }, d), /citer BENCH-41/);
});

test('clé d\'issue : un mot-chiffre au milieu d\'un segment n\'est pas une clé (bump-node-20, release/v2, x-utf-8)', async (t) => {
  for (const branch of ['chore/bump-node-20', 'feature/x-utf-8-fix', 'release/v2']) {
    const d = fakeDeps({ runs: ON_BRANCH(branch), env: NO_LINEAR });
    assert.match(await decide(shell('git commit -m x'), { processGate: {} }, d), /refusé/, branch);
  }
});

test('merge par gh api (pulls/<n>/merge) : toujours refusé, guillemets compris', async (t) => {
  for (const cmd of ['gh api -X PUT repos/o/r/pulls/42/merge', 'gh api --method PUT "repos/o/r/pulls/42/merge" -f merge_method=squash']) {
    assert.match(await decide(shell(cmd), { processGate: {} }, fakeDeps({ env: NO_LINEAR })), /merge réservé à l'humain/, cmd);
    assert.match(await decide(shell(cmd), { processGate: { agentMerge: true } }, fakeDeps({ env: NO_LINEAR })), /utilise gh pr merge/, cmd);
  }
  assert.strictEqual(await decide(shell('gh api repos/o/r/pulls/42/comments'), { processGate: {} }, fakeDeps({ env: NO_LINEAR })), null);
});
