// PreToolUse (matcher Agent) : impose l'architecture d'agents Haiku-first.
// Fail-open : toute exception -> exit 0 sans decision.
// Exporte decide(input) pour les tests ; ne s'execute que s'il est lance directement.
'use strict';
const fs = require('fs');
const path = require('path');
const { configDir } = require('./lib/paths.js');
const { bare, foreignNamespace } = require('./lib/agent-name.js');

const UTILITY = ['Explore', 'Plan', 'claude-code-guide', 'statusline-setup', 'fr-reviewer', 'linear-planner'];
const KNOWN_FIXED_MODEL = ['haiku-scout', 'haiku-builder', 'sonnet-reviewer', 'sonnet-builder', 'sonnet-lead', 'implementer', 'opus-advisor', 'opus-builder', 'haiku-tools'];
const HAIKU_ONLY = ['haiku-scout', 'haiku-builder', 'haiku-tools'];
// Sous-agents Sonnet/Opus autorises a deleguer leurs appels d'outils a haiku-tools (et a rien d'autre).
const TOOL_DELEGATORS = ['sonnet-builder', 'sonnet-reviewer', 'opus-advisor', 'opus-builder'];

function frontmatterModel(name, cwd) {
  const dirs = [];
  if (cwd) dirs.push(path.join(cwd, '.claude', 'agents'));
  dirs.push(path.join(configDir(), 'agents'));
  // Mode plugin : definitions d'agents du plugin (claude/agents, a cote de hooks/).
  dirs.push(path.join(__dirname, '..', 'agents'));
  for (const d of dirs) {
    const f = path.join(d, name + '.md');
    if (!fs.existsSync(f)) continue;
    const txt = fs.readFileSync(f, 'utf8');
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(txt);
    if (!fm) return { found: true, model: null };
    const m = /^model:\s*(.+?)\s*$/m.exec(fm[1]);
    return { found: true, model: m ? m[1].replace(/^["']|["']$/g, '') : null };
  }
  return { found: false };
}

// Retourne null (laisser passer) ou une raison de refus (string).
function decide(input) {
  if (!input || typeof input !== 'object') return null;
  if (input.tool_name !== 'Agent' && input.tool_name !== 'Task') return null;
  const ti = input.tool_input || {};
  const rawType = typeof ti.subagent_type === 'string' ? ti.subagent_type.trim() : '';
  const type = bare(rawType);
  const model = typeof ti.model === 'string' ? ti.model.trim().toLowerCase() : '';
  const prompt = typeof ti.prompt === 'string' ? ti.prompt.trimStart() : '';
  const isSub = Boolean(input.agent_id);
  const callerType = bare(input.agent_type);

  if (model.includes('opus')) {
    return 'Override model "opus" interdit : utilise opus-advisor (plan, decision, architecture, review) ou opus-builder (gros bloc UI, prompt "OPUS:").';
  }
  // Agent d'un autre plugin : jamais assimile a un agent gtko-agents de meme nom nu.
  if (foreignNamespace(rawType)) {
    return 'Agent "' + rawType + '" d\'un autre plugin interdit : utilise gtko-agents:<nom> ou haiku-builder / haiku-scout.';
  }

  if (isSub) {
    if (TOOL_DELEGATORS.includes(callerType)) {
      if (type === 'haiku-tools') return null;
      return callerType + ' ne peut deleguer qu\'a haiku-tools (proxy d\'outils). Pour autre chose, reponds "ESCALATE:" a ton appelant.';
    }
    if (callerType !== 'sonnet-lead') {
      return 'Seuls sonnet-lead et les agents Sonnet/Opus (vers haiku-tools) peuvent deleguer depuis un sous-agent (profondeur max 2). Fais le travail toi-meme et, si besoin, reponds "ESCALATE:" a ton appelant.';
    }
    if (!HAIKU_ONLY.includes(type)) {
      return 'sonnet-lead ne peut deleguer qu\'a haiku-scout, haiku-builder ou haiku-tools. Pour une escalade Sonnet, remonte a l\'orchestrateur avec "ESCALATE:".';
    }
    return null;
  }

  if (!type || type === 'general-purpose' || type === 'claude') {
    return 'Agent generique interdit (herite d\'Opus). Utilise haiku-scout (lecture/exploration/commandes), haiku-builder (tout ce qui produit du code), sonnet-reviewer (relecture sans verificateur automatique) ou sonnet-lead (gros chantier, prompt "LEAD:").';
  }
  if (type === 'fork') {
    if (!prompt.startsWith('OPUS:')) {
      return 'Fork interdit (herite d\'Opus) sauf justification : commence le prompt par "OPUS:" suivi de la raison, ou utilise haiku-builder / haiku-scout.';
    }
    return null;
  }
  if (type === 'sonnet-builder' && !(prompt.startsWith('ESCALADE:') || prompt.startsWith('DIRECT:'))) {
    return 'sonnet-builder n\'est autorise qu\'en escalade ou en usage direct justifie : commence le prompt par "ESCALADE:" (haiku-builder a echoue/escalade, joins ce qu\'il a appris) ou "DIRECT:" (justification). Sinon utilise haiku-builder.';
  }
  if (type === 'opus-builder' && !prompt.startsWith('OPUS:')) {
    return 'opus-builder est reserve aux gros blocs UI / landing pages : commence le prompt par "OPUS:" suivi de la justification. Sinon sonnet-builder (DIRECT:) ou haiku-builder.';
  }
  if (type === 'sonnet-lead' && !prompt.startsWith('LEAD:')) {
    return 'sonnet-lead exige un brief commencant par "LEAD:" (objectif, lots, contraintes, criteres d\'acceptation et de verification).';
  }
  if (UTILITY.includes(type) || KNOWN_FIXED_MODEL.includes(type)) return null;

  // Agent inconnu : refuser s'il herite du modele (Opus) d'apres son frontmatter.
  const fm = frontmatterModel(type, input.cwd);
  if (fm.found && (!fm.model || fm.model === 'inherit' || fm.model.toLowerCase().includes('opus'))) {
    return 'L\'agent "' + type + '" herite du modele d\'Opus (pas de model: dans son frontmatter). Utilise haiku-builder / haiku-scout ou fixe son model:.';
  }
  return null;
}

// Sortie du hook sans I/O (appele par dispatch.js). Fail-open : toute exception -> aucune sortie.
function hook(raw) {
  let stdout = '';
  try {
    const input = JSON.parse(raw);
    if (process.env.ROUTING_GUARD_LOG) {
      try { fs.appendFileSync(process.env.ROUTING_GUARD_LOG, raw.trim() + '\n'); } catch (e) { /* ignore */ }
    }
    const reason = decide(input);
    if (reason) {
      stdout = JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: '[routing-guard] ' + reason,
        },
      });
    }
  } catch (e) { /* fail-open */ }
  return { stdout, stderr: '', exitCode: 0 };
}

function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (e) { /* fail-open */ }
  const r = hook(raw);
  if (r.stdout) process.stdout.write(r.stdout);
  process.exit(r.exitCode);
}

if (require.main === module) main();
module.exports = { decide, hook };
