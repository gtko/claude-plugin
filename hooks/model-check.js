// SessionStart (appele par handoff.js) : avertit en une ligne, sans bloquer, si la session ne tourne pas
// sur le modele orchestrateur prevu (hooks-config.json : orchestratorModel, defaut "sonnet").
// Source du modele, par ordre : champ `model` de l'entree du hook (chaine ou objet {id, display_name}),
// variable ANTHROPIC_MODEL, cle `model` de ~/.claude/settings.json. Inconnu -> rien.
// Une valeur `default` ou vide ne nomme pas un modele : on passe a la source suivante.
// Le nom affiche est tronque a 80 caracteres ; la comparaison utilise le nom complet.
// Interrupteur : MODEL_CHECK=off. Exporte detectModel, checkModel ; fail-open.
'use strict';
const fs = require('fs');
const path = require('path');
const { configDir } = require('./lib/paths.js');

const DEFAULT_ORCHESTRATOR = 'sonnet';
// Valeurs qui ne nomment pas un modele : traitees comme inconnues.
const NOT_A_MODEL = ['', 'default'];
// Nom affiche tronque a ce nombre de caracteres (points de code, points de suspension compris).
const MAX_SHOWN = 80;

// Chaine non vide et ne nommant pas un modele -> nom sans espaces, sinon null.
function concrete(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return NOT_A_MODEL.includes(name.toLowerCase()) ? null : name;
}

// Chaine ou objet { id, display_name } -> nom du modele, ou null.
function modelName(value) {
  if (typeof value === 'string') return concrete(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return concrete(value.id) || concrete(value.display_name);
  }
  return null;
}

// Nom affiche, tronque a MAX_SHOWN caracteres.
function shown(name) {
  const chars = Array.from(name);
  return chars.length > MAX_SHOWN ? chars.slice(0, MAX_SHOWN - 1).join('') + '…' : name;
}

function defaultSettingsPath() {
  return path.join(configDir(), 'settings.json');
}

// Modele de la session, ou null si inconnu.
function detectModel(input, opts) {
  const fromHook = input && typeof input === 'object' ? modelName(input.model) : null;
  if (fromHook) return fromHook;
  const fromEnv = modelName(opts.env.ANTHROPIC_MODEL);
  if (fromEnv) return fromEnv;
  try {
    const settings = JSON.parse(fs.readFileSync(opts.settingsPath, 'utf8'));
    return modelName(settings && settings.model);
  } catch (e) {
    return null;
  }
}

// Retourne la ligne d'avertissement, ou null (conforme, inconnu, desactive, erreur).
function checkModel(input, config, opts) {
  try {
    const o = opts || {};
    const env = o.env || process.env;
    if (env.MODEL_CHECK === 'off') return null;
    const raw = config && config.orchestratorModel;
    const expected = typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_ORCHESTRATOR;
    const actual = detectModel(input, { env, settingsPath: o.settingsPath || defaultSettingsPath() });
    if (!actual || actual.toLowerCase().includes(expected.toLowerCase())) return null;
    return `[Modèle] Session sur ${shown(actual)} ; l'orchestrateur prévu est ${expected} (/model pour changer).`;
  } catch (e) {
    return null;
  }
}

module.exports = { detectModel, checkModel, defaultSettingsPath };
