'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROUTER = path.join(__dirname, '..', 'model-router.js');

test('rappel UserPromptSubmit : une seule ligne, renvoie vers CLAUDE.md et le skill livraison', () => {
  const r = spawnSync(process.execPath, [ROUTER], { input: '', encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  const out = r.stdout;
  assert.ok(out.startsWith('[Routage] '), 'prefixe [Routage] attendu');
  assert.ok(!out.includes('\n') && !out.includes('\r'), 'le rappel doit tenir sur une ligne');
  assert.ok(out.includes('CLAUDE.md'), 'renvoi a CLAUDE.md attendu');
  assert.ok(out.includes('haiku-builder par defaut'), 'haiku-builder par defaut attendu');
  assert.ok(out.includes('parallelise au maximum'), 'regle de parallelisation attendue');
  assert.ok(out.includes('plan/decision/review -> opus-advisor'), 'renvoi a opus-advisor attendu');
  assert.ok(out.includes('skill livraison'), 'renvoi au skill livraison attendu');
});

test('rappel : agent ou skill cites en nom nu, puis variante gtko-agents: une fois chacun (mode plugin)', () => {
  const r = spawnSync(process.execPath, [ROUTER], { input: '', encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  const out = r.stdout;
  assert.ok(out.includes('haiku-builder par defaut, gtko-agents:haiku-builder en mode plugin'), 'variante haiku-builder attendue');
  assert.ok(out.includes('opus-advisor (gtko-agents:opus-advisor en mode plugin)'), 'variante opus-advisor attendue');
  assert.ok(out.includes('skill livraison (gtko-agents:livraison en mode plugin)'), 'variante du skill livraison attendue');
  assert.strictEqual(out.split('gtko-agents:').length - 1, 3, 'chaque variante prefixee une seule fois');
});
