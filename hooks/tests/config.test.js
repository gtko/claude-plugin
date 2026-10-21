'use strict';
const test = require('node:test');
const { after } = test;
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig, BASE_FILE } = require('../lib/config.js');

const dirs = [];
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
  dirs.push(d);
  return d;
}
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

// Positionne CLAUDE_PLUGIN_DATA pour fn (undefined = supprime), puis restaure.
function withPluginData(value, fn) {
  const prev = process.env.CLAUDE_PLUGIN_DATA;
  if (value === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
  else process.env.CLAUDE_PLUGIN_DATA = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = prev;
  }
}

const base = () => JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));

test('sans CLAUDE_PLUGIN_DATA : hooks-config.json tel quel', () => {
  withPluginData(undefined, () => {
    assert.deepStrictEqual(loadConfig(), base());
  });
});

test('local present : ses cles de premier niveau remplacent celles de la base, le reste est conserve', () => {
  const data = tmp();
  fs.writeFileSync(path.join(data, 'hooks-config.local.json'), JSON.stringify({ orchestratorModel: 'opus', handoff: { dir: '/x/handoffs' } }));
  withPluginData(data, () => {
    const cfg = loadConfig();
    const b = base();
    assert.strictEqual(cfg.orchestratorModel, 'opus');
    // Fusion superficielle : l'objet handoff est remplace en entier, pas fusionne champ par champ.
    assert.deepStrictEqual(cfg.handoff, { dir: '/x/handoffs' });
    assert.deepStrictEqual(cfg.contextBudget, b.contextBudget);
    assert.strictEqual(cfg.stateDir, b.stateDir);
  });
});

test('local absent, JSON invalide ou non-objet : configuration de base', () => {
  const data = tmp();
  const local = path.join(data, 'hooks-config.local.json');
  withPluginData(data, () => {
    assert.deepStrictEqual(loadConfig(), base(), 'absent');
    for (const content of ['{ pas du json', '[1, 2]', 'null', '"texte"']) {
      fs.writeFileSync(local, content);
      assert.deepStrictEqual(loadConfig(), base(), content);
    }
  });
});
