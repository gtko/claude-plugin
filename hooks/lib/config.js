// Chargement de hooks-config.json (partage par handoff.js et process-gate.js).
// Si CLAUDE_PLUGIN_DATA est defini et que ${CLAUDE_PLUGIN_DATA}/hooks-config.local.json existe, ses cles de
// premier niveau remplacent celles de hooks-config.json (fusion superficielle). Un local absent ou illisible
// (JSON invalide, pas un objet) est ignore : la configuration de base s'applique alors telle quelle.
'use strict';
const fs = require('fs');
const path = require('path');

const BASE_FILE = path.join(__dirname, '..', 'hooks-config.json');
const LOCAL_NAME = 'hooks-config.local.json';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadConfig() {
  const base = readJson(BASE_FILE);
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  if (!dataDir) return base;
  let local;
  try {
    local = readJson(path.join(dataDir, LOCAL_NAME));
  } catch (e) {
    return base;
  }
  if (!local || typeof local !== 'object' || Array.isArray(local)) return base;
  return Object.assign({}, base, local);
}

module.exports = { loadConfig, BASE_FILE };
