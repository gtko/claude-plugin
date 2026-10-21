// Nom d'agent sans prefixe de plugin : "gtko-agents:haiku-builder" -> "haiku-builder".
// Seul le prefixe gtko-agents: est retire ; un autre prefixe ("evil:haiku-builder") reste tel quel.
'use strict';

const OWN_PREFIX = /^gtko-agents:/;

function bare(t) {
  return String(t || '').replace(OWN_PREFIX, '');
}

// Vrai si le nom porte un prefixe de plugin autre que gtko-agents ("x:general-purpose").
function foreignNamespace(t) {
  const s = String(t || '');
  return /^[^:]+:/.test(s) && !OWN_PREFIX.test(s);
}

module.exports = { bare, foreignNamespace };
