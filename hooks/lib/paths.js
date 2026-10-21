// Chemins des hooks, sous le dossier de configuration Claude Code.
// configDir() = CLAUDE_CONFIG_DIR, sinon ~/.claude. Lu a chaque appel, jamais au chargement du module.
'use strict';
const os = require('os');
const path = require('path');

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// Etat par session (context-budget, model-router) : sous-dossier hook-state.
function hookStateDir() {
  return path.join(configDir(), 'hook-state');
}

// Passations par projet (handoff, pre-compact) : sous-dossier handoffs.
function handoffsDir() {
  return path.join(configDir(), 'handoffs');
}

// Chemin venant de hooks-config.json. "~/.claude" et "~/.claude/<reste>" suivent configDir() ;
// "~" et "~/<reste>" vont au dossier personnel (comme avant) ; tout autre chemin est rendu tel quel.
function expandConfigPath(p) {
  if (typeof p !== 'string') return p;
  const cfg = /^~[\\/]\.claude(?=$|[\\/])/.exec(p);
  if (cfg) return path.join(configDir(), p.slice(cfg[0].length));
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

module.exports = { configDir, hookStateDir, handoffsDir, expandConfigPath };
