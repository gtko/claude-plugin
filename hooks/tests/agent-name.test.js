'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { bare, foreignNamespace } = require('../lib/agent-name.js');
const { decide } = require('../routing-guard.js');

const call = (tool_input, extra = {}) => ({ tool_name: 'Agent', tool_input, ...extra });
const denied = (inp) => assert.ok(decide(inp), 'devait etre refuse');
const allowed = (inp) => assert.strictEqual(decide(inp), null);

// Positionne des variables d'environnement pour fn ; undefined = supprimee. Restaure ensuite.
function withEnv(vars, fn) {
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

test('bare : retire le seul prefixe gtko-agents:, garde le nom nu', () => {
  assert.strictEqual(bare('gtko-agents:haiku-builder'), 'haiku-builder');
  assert.strictEqual(bare('haiku-builder'), 'haiku-builder');
  assert.strictEqual(bare('Explore'), 'Explore');
  assert.strictEqual(bare(''), '');
  assert.strictEqual(bare(undefined), '');
  assert.strictEqual(bare(null), '');
});

test('bare : un autre prefixe de plugin n\'est pas retire', () => {
  assert.strictEqual(bare('evil:haiku-builder'), 'evil:haiku-builder');
  assert.strictEqual(bare('x:general-purpose'), 'x:general-purpose');
  assert.strictEqual(bare('gtko-agents-evil:haiku-builder'), 'gtko-agents-evil:haiku-builder');
});

test('foreignNamespace : vrai pour tout prefixe autre que gtko-agents:', () => {
  assert.strictEqual(foreignNamespace('evil:haiku-builder'), true);
  assert.strictEqual(foreignNamespace('x:general-purpose'), true);
  assert.strictEqual(foreignNamespace('gtko-agents:haiku-builder'), false);
  assert.strictEqual(foreignNamespace('haiku-builder'), false);
  assert.strictEqual(foreignNamespace(''), false);
  assert.strictEqual(foreignNamespace(undefined), false);
});

test('routing-guard : prefixe etranger refuse, meme pour un nom gtko-agents autorise', () => {
  allowed(call({ subagent_type: 'gtko-agents:haiku-builder', prompt: 'x' }));
  denied(call({ subagent_type: 'evil:haiku-builder', prompt: 'x' }));
  denied(call({ subagent_type: 'x:general-purpose', prompt: 'x' }));
  denied(call({ subagent_type: 'evil:sonnet-builder', prompt: 'ESCALADE: x' }));
  denied(call({ subagent_type: 'evil:haiku-tools', prompt: 'x' }));
});

test('routing-guard : appelant de sous-agent a prefixe etranger ne peut rien deleguer', () => {
  const sub = (t) => ({ agent_id: 'a9', agent_type: t });
  denied(call({ subagent_type: 'haiku-scout', prompt: 'x' }, sub('evil:sonnet-lead')));
  denied(call({ subagent_type: 'haiku-tools', prompt: 'x' }, sub('evil:sonnet-reviewer')));
  allowed(call({ subagent_type: 'haiku-scout', prompt: 'x' }, sub('gtko-agents:sonnet-lead')));
});

test('routing-guard : subagent_type prefixe par le plugin = meme regle que le nom nu', () => {
  allowed(call({ subagent_type: 'gtko-agents:haiku-builder', prompt: 'x' }));
  denied(call({ subagent_type: 'gtko-agents:general-purpose', prompt: 'x' }));
  denied(call({ subagent_type: 'gtko-agents:sonnet-builder', prompt: 'fais ca' }));
  allowed(call({ subagent_type: 'gtko-agents:sonnet-builder', prompt: 'ESCALADE: haiku a echoue' }));
  denied(call({ subagent_type: 'gtko-agents:fork', prompt: 'fais ca' }));
  allowed(call({ subagent_type: 'gtko-agents:fork', prompt: 'OPUS: contexte complet necessaire' }));
  denied(call({ subagent_type: 'gtko-agents:opus-builder', prompt: 'landing' }));
});

test('routing-guard : agent_type prefixe du sous-agent compare au nom nu', () => {
  const sub = (t) => ({ agent_id: 'a1', agent_type: t });
  allowed(call({ subagent_type: 'haiku-scout', prompt: 'x' }, sub('gtko-agents:sonnet-lead')));
  denied(call({ subagent_type: 'haiku-builder', prompt: 'x' }, sub('gtko-agents:haiku-builder')));
  allowed(call({ subagent_type: 'haiku-tools', prompt: 'x' }, sub('gtko-agents:sonnet-reviewer')));
});

test('routing-guard : agent inconnu lu dans CLAUDE_CONFIG_DIR/agents', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-name-'));
  try {
    fs.mkdirSync(path.join(root, 'agents'));
    // Sans model: herite d'Opus -> refuse. Avec model: sonnet -> autorise.
    fs.writeFileSync(path.join(root, 'agents', 'mon-agent.md'), '---\nname: mon-agent\n---\ncorps\n');
    fs.writeFileSync(path.join(root, 'agents', 'mon-sonnet.md'), '---\nname: mon-sonnet\nmodel: sonnet\n---\ncorps\n');
    withEnv({ CLAUDE_CONFIG_DIR: root }, () => {
      denied(call({ subagent_type: 'mon-agent', prompt: 'x' }));
      denied(call({ subagent_type: 'gtko-agents:mon-agent', prompt: 'x' }));
      allowed(call({ subagent_type: 'mon-sonnet', prompt: 'x' }));
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
