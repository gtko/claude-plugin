'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectModel, checkModel } = require('../model-check.js');

const CFG = { orchestratorModel: 'sonnet' };

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'model-check-'));
}

// Chemin de settings.json qui n'existe pas : aucune source fichier.
function noSettings() {
  return path.join(tmpRoot(), 'settings.json');
}

// Ecrit un settings.json (objet ou texte brut) et renvoie son chemin.
function writeSettings(content) {
  const f = path.join(tmpRoot(), 'settings.json');
  fs.writeFileSync(f, typeof content === 'string' ? content : JSON.stringify(content));
  return f;
}

// Options isolees : pas d'env de la machine, pas de settings.json reel.
function opts(extra) {
  return { env: {}, settingsPath: noSettings(), ...extra };
}

function line(actual, expected = 'sonnet') {
  return `[Modèle] Session sur ${actual} ; l'orchestrateur prévu est ${expected} (/model pour changer).`;
}

test('modele conforme (sous-chaine, casse ignoree) : aucune ligne', () => {
  for (const model of ['claude-sonnet-4-6', 'SONNET', 'sonnet[1m]']) {
    assert.strictEqual(checkModel({ model }, CFG, opts()), null, model);
  }
});

test('autre modele en chaine : une ligne', () => {
  assert.strictEqual(checkModel({ model: 'claude-opus-5-5' }, CFG, opts()), line('claude-opus-5-5'));
});

test('autre modele en objet {id, display_name} : id utilise', () => {
  const model = { id: 'claude-haiku-5-5', display_name: 'Haiku 5.5' };
  assert.strictEqual(checkModel({ model }, CFG, opts()), line('claude-haiku-5-5'));
});

test('objet sans id : display_name utilise, conforme ou non', () => {
  assert.strictEqual(checkModel({ model: { display_name: 'Opus 5.5' } }, CFG, opts()), line('Opus 5.5'));
  assert.strictEqual(checkModel({ model: { display_name: 'Sonnet 4.6' } }, CFG, opts()), null);
});

test('ordre des sources : entree du hook > ANTHROPIC_MODEL > settings.json', () => {
  const settingsPath = writeSettings({ model: 'opus' });
  assert.strictEqual(checkModel({ model: 'sonnet' }, CFG, { env: { ANTHROPIC_MODEL: 'opus' }, settingsPath }), null);
  assert.strictEqual(checkModel({}, CFG, { env: { ANTHROPIC_MODEL: 'sonnet' }, settingsPath }), null);
  assert.strictEqual(checkModel({}, CFG, { env: { ANTHROPIC_MODEL: 'opus' }, settingsPath }), line('opus'));
  assert.strictEqual(checkModel({}, CFG, { env: {}, settingsPath }), line('opus'));
});

test('modele inconnu : aucune ligne', () => {
  assert.strictEqual(checkModel({ cwd: 'x' }, CFG, opts()), null);
  assert.strictEqual(checkModel(null, CFG, opts()), null);
  assert.strictEqual(checkModel({ model: '  ' }, CFG, opts()), null);
  assert.strictEqual(checkModel({ model: {} }, CFG, opts()), null);
  assert.strictEqual(checkModel({}, CFG, { env: {}, settingsPath: writeSettings('pas du json') }), null);
  assert.strictEqual(checkModel({}, CFG, { env: {}, settingsPath: writeSettings({ theme: 'dark' }) }), null);
});

test('detectModel : chaine vide ignoree, repli sur la source suivante', () => {
  assert.strictEqual(detectModel({ model: '' }, { env: { ANTHROPIC_MODEL: 'opus' }, settingsPath: noSettings() }), 'opus');
  assert.strictEqual(detectModel({}, { env: {}, settingsPath: noSettings() }), null);
});

test('orchestratorModel absent ou invalide : defaut sonnet', () => {
  assert.strictEqual(checkModel({ model: 'opus' }, {}, opts()), line('opus', 'sonnet'));
  assert.strictEqual(checkModel({ model: 'opus' }, null, opts()), line('opus', 'sonnet'));
  assert.strictEqual(checkModel({ model: 'opus' }, { orchestratorModel: 42 }, opts()), line('opus', 'sonnet'));
  assert.strictEqual(checkModel({ model: 'sonnet' }, {}, opts()), null);
});

test('orchestratorModel personnalise : compare a cette valeur', () => {
  assert.strictEqual(checkModel({ model: 'opus' }, { orchestratorModel: 'opus' }, opts()), null);
  assert.strictEqual(checkModel({ model: 'sonnet' }, { orchestratorModel: 'opus' }, opts()), line('sonnet', 'opus'));
});

test('MODEL_CHECK=off : aucune ligne, meme pour un modele non conforme', () => {
  assert.strictEqual(checkModel({ model: 'opus' }, CFG, opts({ env: { MODEL_CHECK: 'off' } })), null);
});

test('fail-open : une exception donne null, jamais une erreur', () => {
  const env = {};
  Object.defineProperty(env, 'MODEL_CHECK', { get() { throw new Error('boom'); } });
  assert.strictEqual(checkModel({ model: 'opus' }, CFG, opts({ env })), null);
});

test('opusplan avertit : choix assume (alias Opus en plan, Sonnet sinon)', () => {
  assert.strictEqual(checkModel({ model: 'opusplan' }, CFG, opts()), line('opusplan'));
});

test('default ou vide : inconnu, aucune ligne', () => {
  for (const model of ['default', 'DEFAULT', '  Default  ', '', '   ']) {
    assert.strictEqual(checkModel({ model }, CFG, opts()), null, JSON.stringify(model));
  }
  assert.strictEqual(checkModel({ model: { id: 'default' } }, CFG, opts()), null);
});

test('default ou vide ne masque pas la source suivante', () => {
  for (const model of ['default', '']) {
    const o = { env: { ANTHROPIC_MODEL: 'opus' }, settingsPath: noSettings() };
    assert.strictEqual(checkModel({ model }, CFG, o), line('opus'), JSON.stringify(model));
  }
});

test('nom affiche tronque a 80 caracteres (comparaison sur le nom complet)', () => {
  const exact = 'a'.repeat(80);
  assert.strictEqual(checkModel({ model: exact }, CFG, opts()), line(exact));
  const long = 'claude-' + 'é'.repeat(200);
  const out = checkModel({ model: long }, CFG, opts());
  const shownName = /Session sur (.+) ; l'orchestrateur/.exec(out)[1];
  assert.strictEqual(Array.from(shownName).length, 80);
  assert.strictEqual(shownName, Array.from(long).slice(0, 79).join('') + '…');
  assert.strictEqual(checkModel({ model: 'x'.repeat(100) + 'sonnet' }, CFG, opts()), null);
});
