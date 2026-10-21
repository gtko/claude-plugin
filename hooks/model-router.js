// UserPromptSubmit hook: injecte le rappel court du routage des modeles.
// Une seule fois par session : etat router-<session>.json dans stateDir (hooks-config.json), remis a zero
// par handoff.js sur SessionStart compact ou clear, donc le rappel revient apres un compactage.
// Sans session_id (entree absente ou invalide) : le rappel est emis a chaque message, comme avant.
// Le texte ecrit sur stdout est ajoute au contexte de Claude (invisible pour l'utilisateur).
// Exporte RAPPEL, rappelFor(input, config), routerStatePath ; fail-open.
'use strict';
const fs = require('fs');
const path = require('path');
const { stateDirOf, loadConfig } = require('./handoff.js');

// Une seule ligne : le detail des regles est dans ~/.claude/CLAUDE.md et le skill livraison.
const RAPPEL =
  "[Routage] Delegue selon CLAUDE.md (haiku-builder par defaut, gtko-agents:haiku-builder en mode plugin), parallelise au maximum (lots independants dans le meme message) ; plan/decision/review -> opus-advisor (gtko-agents:opus-advisor en mode plugin) ; modification de code -> skill livraison (gtko-agents:livraison en mode plugin), charge AVANT la premiere edition : issue Linear reprise ou creee puis In Progress, branche liee, tests et lint, review par un sous-agent, PR Fixes <ID>, CI apres chaque push, commentaires PR et Linear traites, In Review, jamais de merge.";

// Chemin de l'etat ; identifiant de session assaini (meme regle que context-budget.js).
function routerStatePath(stateDir, sessionId) {
  const sid = typeof sessionId === 'string' && sessionId ? sessionId : 'default';
  return path.join(stateDir, 'router-' + sid.replace(/[^A-Za-z0-9_-]/g, '_') + '.json');
}

function alreadyEmitted(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).emitted === true;
  } catch (e) {
    return false;
  }
}

function markEmitted(file) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ emitted: true }));
  } catch (e) { /* etat perdu : le rappel reviendra au message suivant */ }
}

// Texte a emettre pour ce message : RAPPEL, ou '' si deja emis dans cette session.
function rappelFor(input, config) {
  const sid = input && typeof input === 'object' && typeof input.session_id === 'string' ? input.session_id : '';
  if (!sid) return RAPPEL;
  const file = routerStatePath(stateDirOf(config), sid);
  if (alreadyEmitted(file)) return '';
  markEmitted(file);
  return RAPPEL;
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (e) { return ''; }
}

// Sortie du hook sans I/O (appele par dispatch.js) : rappel, ou rien si deja emis. Fail-open : erreur -> rappel.
function hook(raw) {
  let out = RAPPEL;
  try {
    const input = raw.trim() ? JSON.parse(raw) : null;
    out = rappelFor(input, loadConfig());
  } catch (e) {
    out = RAPPEL; // fail-open : comportement d'avant
  }
  return { stdout: out || '', stderr: '', exitCode: 0 };
}

function main() {
  const r = hook(readStdin());
  if (r.stdout) process.stdout.write(r.stdout);
  process.exitCode = 0;
}

module.exports = { RAPPEL, rappelFor, routerStatePath, hook };
if (require.main === module) main();
