'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { decide } = require('../routing-guard.js');

const GUARD = path.join(__dirname, '..', 'routing-guard.js');
const call = (tool_input, extra = {}) => ({ tool_name: 'Agent', tool_input, ...extra });
const denied = (inp) => assert.ok(decide(inp), 'devait etre refuse');
const allowed = (inp) => assert.strictEqual(decide(inp), null);

test('principal : subagent_type absent / general-purpose / claude refuses', () => {
  denied(call({ prompt: 'x' }));
  denied(call({ subagent_type: 'general-purpose', prompt: 'x' }));
  denied(call({ subagent_type: 'claude', prompt: 'x' }));
});

test('override model opus refuse', () => {
  denied(call({ subagent_type: 'haiku-builder', model: 'opus', prompt: 'x' }));
  denied(call({ subagent_type: 'Explore', model: 'claude-opus-5-5', prompt: 'x' }));
});

test('fork : refuse sauf prefixe OPUS:', () => {
  denied(call({ subagent_type: 'fork', prompt: 'fais ca' }));
  allowed(call({ subagent_type: 'fork', prompt: 'OPUS: contexte complet necessaire' }));
});

test('sonnet-builder : ESCALADE:/DIRECT: requis', () => {
  denied(call({ subagent_type: 'sonnet-builder', prompt: 'fais ca' }));
  allowed(call({ subagent_type: 'sonnet-builder', prompt: 'ESCALADE: haiku a echoue' }));
  allowed(call({ subagent_type: 'sonnet-builder', prompt: 'DIRECT: justification' }));
});

test('sonnet-lead : LEAD: requis', () => {
  denied(call({ subagent_type: 'sonnet-lead', prompt: 'gros chantier' }));
  allowed(call({ subagent_type: 'sonnet-lead', prompt: 'LEAD: objectif...' }));
});

test('agents du graphe et utilitaires autorises depuis le principal', () => {
  for (const t of ['haiku-scout', 'haiku-builder', 'sonnet-reviewer', 'Explore', 'Plan', 'claude-code-guide', 'statusline-setup', 'fr-reviewer', 'linear-planner']) {
    allowed(call({ subagent_type: t, prompt: 'x' }));
  }
});

test('sous-agent : seul sonnet-lead delegue, uniquement vers haiku-*', () => {
  denied(call({ subagent_type: 'haiku-builder', prompt: 'x' }, { agent_id: 'a1', agent_type: 'haiku-builder' }));
  denied(call({ subagent_type: 'haiku-builder', prompt: 'x' }, { agent_id: 'a1', agent_type: 'sonnet-builder' }));
  denied(call({ subagent_type: 'haiku-builder', prompt: 'x' }, { agent_id: 'a1' }));
  denied(call({ subagent_type: 'sonnet-builder', prompt: 'ESCALADE: x' }, { agent_id: 'a2', agent_type: 'sonnet-lead' }));
  denied(call({ subagent_type: 'general-purpose', prompt: 'x' }, { agent_id: 'a2', agent_type: 'sonnet-lead' }));
  denied(call({ subagent_type: 'Explore', prompt: 'x' }, { agent_id: 'a2', agent_type: 'sonnet-lead' }));
  allowed(call({ subagent_type: 'haiku-builder', prompt: 'x' }, { agent_id: 'a2', agent_type: 'sonnet-lead' }));
  allowed(call({ subagent_type: 'haiku-scout', prompt: 'x' }, { agent_id: 'a2', agent_type: 'sonnet-lead' }));
});

test('agent_type seul (session --agent, sans agent_id) = appel principal', () => {
  allowed(call({ subagent_type: 'haiku-scout', prompt: 'x' }, { agent_type: 'foo' }));
});

test('autre outil ou entree invalide : pas de decision', () => {
  allowed({ tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.strictEqual(decide(null), null);
  assert.strictEqual(decide('texte'), null);
  assert.strictEqual(decide({}), null);
});

function run(stdin) {
  return spawnSync(process.execPath, [GUARD], { input: stdin, encoding: 'utf8' });
}

test('CLI : refus = JSON deny, exit 0', () => {
  const r = run(JSON.stringify(call({ subagent_type: 'general-purpose', prompt: 'x' })));
  assert.strictEqual(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /haiku-builder/);
});

test('CLI : autorise = sortie vide, exit 0', () => {
  const r = run(JSON.stringify(call({ subagent_type: 'haiku-scout', prompt: 'x' })));
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

test('opus-advisor autorise ; opus-builder exige OPUS:', () => {
  allowed(call({ subagent_type: 'opus-advisor', prompt: 'plan' }));
  denied(call({ subagent_type: 'opus-builder', prompt: 'landing' }));
  allowed(call({ subagent_type: 'opus-builder', prompt: 'OPUS: landing page complete' }));
  denied(call({ subagent_type: 'opus-advisor', prompt: 'x' }, { agent_id: 'a1', agent_type: 'sonnet-lead' }));
});

test('haiku-tools : proxy pour Sonnet/Opus, interdit depuis Haiku', () => {
  const sub = (t) => ({ agent_id: 'a1', agent_type: t });
  allowed(call({ subagent_type: 'haiku-tools', prompt: 'x' }));
  for (const t of ['sonnet-builder', 'sonnet-reviewer', 'opus-advisor', 'opus-builder', 'sonnet-lead']) {
    allowed(call({ subagent_type: 'haiku-tools', prompt: 'x' }, sub(t)));
  }
  denied(call({ subagent_type: 'haiku-builder', prompt: 'x' }, sub('opus-builder')));
  denied(call({ subagent_type: 'haiku-tools', prompt: 'x' }, sub('haiku-builder')));
  denied(call({ subagent_type: 'haiku-tools', prompt: 'x' }, sub('haiku-scout')));
});

test('agent du dépôt (.claude/agents du projet) sans model: ou model: inherit : admis ; model: opus explicite refusé', () => {
  const fs = require('fs');
  const os = require('os');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-repo-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-home-'));
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = home;
  try {
    const write = (dir, name, fm) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name + '.md'), `---\nname: ${name}\n${fm}---\nCorps.\n`);
    };
    const agents = path.join(repo, '.claude', 'agents');
    write(agents, 'reviewer', 'description: relecteur du projet\n');
    write(agents, 'heriteur', 'model: inherit\n');
    write(agents, 'gros', 'model: opus\n');
    write(path.join(home, 'agents'), 'perso', 'description: agent utilisateur sans model\n');
    allowed(call({ subagent_type: 'reviewer', prompt: 'Relis' }, { cwd: repo }));
    allowed(call({ subagent_type: 'heriteur', prompt: 'x' }, { cwd: repo }));
    denied(call({ subagent_type: 'gros', prompt: 'x' }, { cwd: repo }));
    denied(call({ subagent_type: 'perso', prompt: 'x' }, { cwd: repo }));
    denied(call({ subagent_type: 'reviewer', model: 'opus', prompt: 'x' }, { cwd: repo }));
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev;
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('run ex01 : agent hors graphe sans model: mais appelé avec model: "sonnet" : admis ; message de refus avec alternative', () => {
  const fs = require('fs');
  const os = require('os');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-home-'));
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = home;
  try {
    fs.mkdirSync(path.join(home, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(home, 'agents', 'perso.md'), '---\nname: perso\n---\nCorps.\n');
    allowed(call({ subagent_type: 'perso', model: 'sonnet', prompt: 'Relis le diff' }));
    allowed(call({ subagent_type: 'perso', model: 'haiku', prompt: 'x' }));
    const r = decide(call({ subagent_type: 'perso', prompt: 'x' }));
    assert.match(r, /sonnet-reviewer ou opus-advisor/);
    assert.match(r, /Ne t'arrete pas/);
    denied(call({ subagent_type: 'general-purpose', model: 'sonnet', prompt: 'x' }));
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
