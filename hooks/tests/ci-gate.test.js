'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { decide, checksGreen, isInReview } = require('../ci-gate.js');

const GATE = path.join(__dirname, '..', 'ci-gate.js');
const GREEN = { stdout: 'All checks were successful\n0 failing, 2 successful, 0 skipped, and 0 pending checks\n✓  test\turl\n✓  lint\turl', stderr: '' };
const RED = { stdout: 'Some checks were not successful\n1 failing, 1 successful, 0 skipped, and 0 pending checks\nX  test\turl', stderr: '' };

// Etat en memoire et horloge pilotee : aucun fichier ecrit.
function world() {
  const store = {};
  const clock = { t: 1000 };
  const deps = {
    env: {},
    now: () => clock.t,
    read: (f) => JSON.parse(JSON.stringify(store[f] || {})),
    write: (f, s) => { store[f] = JSON.parse(JSON.stringify(s)); },
  };
  const cfg = { stateDir: '/tmp/ci-gate-test' };
  const tick = (ms = 1000) => { clock.t += ms; };
  const bash = (event, command, id, tool_response) => decide({ hook_event_name: event, tool_name: 'Bash', tool_input: { command }, tool_use_id: id, session_id: 's1', tool_response }, cfg, deps);
  const inReview = (tool_name = 'mcp__linear__save_issue', state = 'In Review') => decide({ hook_event_name: 'PreToolUse', tool_name, tool_input: { id: 'BENCH-1', state }, session_id: 's1' }, cfg, deps);
  return { deps, cfg, tick, bash, inReview, store };
}

// Commande lancee puis terminee (sequentielle).
function run(w, command, id, response) {
  w.bash('PreToolUse', command, id);
  w.tick();
  w.bash('PostToolUse', command, id, response);
  w.tick();
}

test('run réel du benchmark : gh pr checks dans le même lot que git push, puis In Review : refusé', () => {
  const w = world();
  // Lot parallele : les PreToolUse partent ensemble, les PostToolUse suivent.
  w.bash('PreToolUse', 'gh pr create --title "x (BENCH-1)" --body-file b.md', 'a');
  w.bash('PreToolUse', 'gh pr checks', 'b');
  w.bash('PreToolUse', 'git push -u origin BENCH-1-find-user-by-id', 'c');
  w.tick();
  w.bash('PostToolUse', 'gh pr checks', 'b', GREEN);
  w.tick();
  w.bash('PostToolUse', 'git push -u origin BENCH-1-find-user-by-id', 'c', { stdout: '' });
  w.tick();
  assert.match(w.inReview(), /n'a pas été vérifiée après le dernier push/);
});

test('push, puis gh pr checks vert en séquence : In Review accepté', () => {
  const w = world();
  run(w, 'git push -u origin BENCH-1-x', 'p');
  run(w, 'gh pr checks 1 --watch', 'k', GREEN);
  assert.strictEqual(w.inReview(), null);
});

test('git commit && git push && gh pr checks dans une même commande (run ex02) : ne compte pas, appel séparé exigé', () => {
  const w = world();
  run(w, 'git add -A && git commit -q -m x && git push -q origin B-1 && gh pr comment 1 --body y && gh pr checks 1', 'pk', GREEN);
  assert.match(w.inReview(), /appel séparé/);
  run(w, 'gh pr checks 1 --watch', 'k', GREEN);
  assert.strictEqual(w.inReview(), null);
});

test('gh pr checks ; git push dans une même commande : push postérieur, refusé', () => {
  const w = world();
  run(w, 'gh pr checks 1; git push', 'kp', GREEN);
  assert.match(w.inReview(), /n'a pas été vérifiée/);
});

test('nouveau push après une CI verte (correctif post-review) : CI à revérifier', () => {
  const w = world();
  run(w, 'git push -u origin B-1', 'p1');
  run(w, 'gh pr checks 1 --watch', 'k1', GREEN);
  run(w, 'git push', 'p2');
  assert.match(w.inReview(), /n'a pas été vérifiée/);
  run(w, 'gh pr checks 1 --watch', 'k2', GREEN);
  assert.strictEqual(w.inReview(), null);
});

test('dernière CI rouge ou en attente : refusé ; relance verte : accepté', () => {
  const w = world();
  run(w, 'git push', 'p');
  run(w, 'gh pr checks 1', 'k1', RED);
  assert.match(w.inReview(), /n'est pas vert/);
  run(w, 'gh pr checks 1', 'k2', { stdout: 'Some checks are still pending\n0 failing, 1 successful, 0 skipped, and 1 pending checks' });
  assert.match(w.inReview(), /n'est pas vert/);
  run(w, 'gh run rerun 7 --failed', 'r');
  run(w, 'gh pr checks 1 --watch', 'k3', GREEN);
  assert.strictEqual(w.inReview(), null);
});

test('aucun push dans la session, ou push --dry-run : In Review non bloqué', () => {
  const w = world();
  assert.strictEqual(w.inReview(), null);
  run(w, 'git push --dry-run', 'd');
  assert.strictEqual(w.inReview(), null);
});

test('autres outils et autres statuts : ignorés', () => {
  const w = world();
  run(w, 'git push', 'p');
  assert.strictEqual(w.inReview('mcp__linear__save_issue', 'In Progress'), null);
  assert.strictEqual(w.inReview('mcp__linear__get_issue'), null);
  assert.strictEqual(w.inReview('mcp__github__save_issue'), null);
  assert.match(w.inReview('mcp__claude_ai_Linear__save_issue'), /n'a pas été vérifiée/);
});

test('CLI linear issue update --state "In Review" détectée', () => {
  assert.strictEqual(isInReview({ tool_name: 'Bash', tool_input: { command: 'linear issue update BENCH-1 --state "In Review"' } }), true);
  assert.strictEqual(isInReview({ tool_name: 'Bash', tool_input: { command: 'linear issue update BENCH-1 --state "In Progress"' } }), false);
});

test('checksGreen : résumé, dernier résumé de --watch, JSON, tabulations, aucune CI, illisible', () => {
  assert.strictEqual(checksGreen(GREEN), true);
  assert.strictEqual(checksGreen(RED), false);
  assert.strictEqual(checksGreen({ stdout: 'Some checks are still pending\n...\nAll checks were successful' }), true);
  assert.strictEqual(checksGreen({ stdout: '[{"name":"t","bucket":"pass"},{"name":"l","bucket":"skipping"}]' }), true);
  assert.strictEqual(checksGreen({ stdout: '[{"name":"t","state":"SKIPPED"},{"name":"l","state":"NEUTRAL"}]' }), true);
  assert.strictEqual(checksGreen({ stdout: '[{"name":"t","bucket":"fail"}]' }), false);
  assert.strictEqual(checksGreen({ stdout: 'test\tpass\t1m\turl\nlint\tfail\t2s\turl' }), false);
  assert.strictEqual(checksGreen({ stdout: '', stderr: "no checks reported on the 'x' branch" }), true);
  assert.strictEqual(checksGreen({ stdout: 'rien' }), null);
});

test('CI_GATE=off ou ciGate.enabled=false : rien n\'est refusé', () => {
  const w = world();
  run(w, 'git push', 'p');
  w.deps.env.CI_GATE = 'off';
  assert.strictEqual(w.inReview(), null);
  w.deps.env.CI_GATE = undefined;
  const r = decide({ hook_event_name: 'PreToolUse', tool_name: 'mcp__linear__save_issue', tool_input: { state: 'In Review' }, session_id: 's1' }, { ...w.cfg, ciGate: { enabled: false } }, w.deps);
  assert.strictEqual(r, null);
});

test('fail-open : lecture d\'état qui lève, entrée invalide', () => {
  assert.strictEqual(decide({ hook_event_name: 'PreToolUse', tool_name: 'mcp__linear__save_issue', tool_input: { state: 'In Review' } }, {}, { read: () => { throw new Error('x'); } }), null);
  assert.strictEqual(decide(null, {}, {}), null);
});

test('CLI : séquence réelle sur disque, refus au format deny puis acceptation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gate-'));
  try {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: dir, CLAUDE_PLUGIN_DATA: '' };
    const call = (input) => spawnSync(process.execPath, [GATE], { input: JSON.stringify({ session_id: 'cli', ...input }), encoding: 'utf8', env });
    call({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git push' }, tool_use_id: 'p' });
    const refused = call({ hook_event_name: 'PreToolUse', tool_name: 'mcp__linear__save_issue', tool_input: { state: 'In Review' } });
    assert.match(refused.stdout, /"permissionDecision":"deny"/);
    assert.match(refused.stdout, /\[ci-gate\]/);
    call({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'gh pr checks 1 --watch' }, tool_use_id: 'k' });
    call({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'gh pr checks 1 --watch' }, tool_use_id: 'k', tool_response: GREEN });
    const ok = call({ hook_event_name: 'PreToolUse', tool_name: 'mcp__linear__save_issue', tool_input: { state: 'In Review' } });
    assert.strictEqual(ok.stdout, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
