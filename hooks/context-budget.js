// UserPromptSubmit : mesure le contexte (fin du transcript) et applique le budget.
// Seuils absolus en tokens de contexte (entree + cache du dernier tour) : delegue (texte), passation (texte + ligne /compact prete a coller), blocage une seule fois,
// puis avertissement une seule fois. Chaque niveau est annonce une fois par cycle (remis a zero sur chute du contexte de plus de 30 %).
// Etat par session dans stateDir/ctx-<session>.json ; interrupteur : CONTEXT_BUDGET=off.
// Exporte measure, decide(input, config, state), run(input, config), statePath, compactLine, readTail ; fail-open.
'use strict';
const fs = require('fs');
const path = require('path');
const { handoffPath, stateDirOf, loadConfig, PRECOMPACT_BLOCK } = require('./handoff.js');

const TAIL_BYTES = 512 * 1024;
// Chute du contexte par rapport au dernier mesure au-dela de laquelle on suppose une compaction ou un /clear.
const RESET_DROP = 0.3;
// warn : avertissement donne apres le blocage ; il ne se repete plus tant que le contexte reste au-dessus du seuil.
const RANK = { none: 0, delegate: 1, handoff: 2, block: 3, warn: 4 };
const LEVELS = Object.keys(RANK);
const PASSATION_RE = /passation|handoff/i;
const SECTIONS = 'titre, Tâche, Issue Linear, Branche/worktree, Fait, Reste à faire (étapes concrètes), Décisions, Fichiers clés, Vérification';
const GENERIC_KEEP = 'issue en cours, branche et worktree, décisions, reste à faire, agents en cours';
const COMPACT_MAX = 300;
const TASK_MAX = 120;
const BULLET_RE = /^(?:[-*•]|\d+[.)])\s+/;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Tokens en milliers pour les messages : 305000 -> "305k".
const kTok = (n) => `${Math.round(n / 1000)}k`;

// Lit uniquement la fin du fichier (512 Ko). Le premier fragment de ligne est ignore plus tard.
function readTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// Retourne { ctx, model } de la derniere reponse principale du transcript, ou null.
function measure(transcriptPath) {
  try {
    if (typeof transcriptPath !== 'string' || !transcriptPath) return null;
    const lines = readTail(transcriptPath).split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      let obj;
      try { obj = JSON.parse(lines[i]); } catch (e) { continue; }
      if (!obj || obj.type !== 'assistant' || obj.isSidechain === true) continue;
      const msg = obj.message;
      if (!msg || !msg.usage || typeof msg.usage !== 'object') continue;
      const u = msg.usage;
      return {
        ctx: num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens),
        model: typeof msg.model === 'string' ? msg.model : null,
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

function freshState() {
  return { level: 'none', blocked: false, lastCtx: null };
}

// Etat valide ou valeurs par defaut (fichier absent ou corrompu).
function normalize(st) {
  if (!st || typeof st !== 'object') return freshState();
  return {
    level: LEVELS.includes(st.level) ? st.level : 'none',
    blocked: st.blocked === true,
    lastCtx: Number.isFinite(st.lastCtx) ? st.lastCtx : null,
  };
}

function delegateText(ctx, cfg) {
  return `[Budget contexte ${kTok(ctx)} (seuil délégation ${kTok(cfg.delegateTokens)})] Délègue : ne lis plus de gros fichiers ni logs toi-même, passe par haiku-tools / haiku-scout ; garde des réponses courtes.`;
}

// Lignes de compactage : extraites de la passation (sections Tâche, Issue Linear, Branche/worktree,
// Reste à faire), sur une seule ligne et tronquees ; sans passation utilisable, la version generique.
// Le bloc <!-- precompact --> ecrit par pre-compact.js n'est pas lu.
function sectionLines(text, title) {
  const out = [];
  let on = false;
  for (const line of text.split(/\r?\n/)) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) { on = title.test(h[1].trim()); continue; }
    if (on && line.trim()) out.push(line.trim());
  }
  return out;
}

const plain = (s) => s.replace(BULLET_RE, '').replace(/\*\*/g, '').trim();

// Premiere ligne utile d'une section, sans puce.
function firstLine(lines) {
  for (const l of lines) {
    const t = plain(l);
    if (t) return t;
  }
  return '';
}

// Puces de la section ; a defaut de puces, ses lignes.
function items(lines) {
  const bullets = lines.filter((l) => BULLET_RE.test(l)).map(plain).filter(Boolean);
  return bullets.length ? bullets : lines.map(plain).filter(Boolean);
}

// Ligne « /compact garde : ... » prete a coller, sur une seule ligne, 300 caracteres au plus de resume.
function compactLine(handoffText) {
  const generic = '/compact garde : ' + GENERIC_KEEP;
  if (typeof handoffText !== 'string' || !handoffText.trim()) return generic;
  const text = handoffText.replace(PRECOMPACT_BLOCK, '');
  const parts = [];
  const task = firstLine(sectionLines(text, /^Tâche\b/)).slice(0, TASK_MAX);
  if (task) parts.push('Tâche : ' + task);
  const issue = firstLine(sectionLines(text, /^Issue Linear\b/));
  if (issue) parts.push('Issue : ' + issue);
  const branch = firstLine(sectionLines(text, /^Branche\/worktree\b/));
  if (branch) parts.push('Branche : ' + branch);
  const todo = items(sectionLines(text, /^Reste à faire\b/));
  if (todo.length) parts.push('Reste : ' + todo.join(' ; '));
  if (!parts.length) return generic;
  let summary = parts.join(' ; ').replace(/\s+/g, ' ').trim();
  if (summary.length > COMPACT_MAX) summary = summary.slice(0, COMPACT_MAX - 1) + '…';
  return '/compact garde : ' + summary;
}

// Ligne de compactage d'apres le fichier de passation ; generique s'il est absent ou illisible.
function compactLineFor(file) {
  try {
    if (file && fs.existsSync(file)) return compactLine(fs.readFileSync(file, 'utf8'));
  } catch (e) { /* illisible : version generique */ }
  return compactLine(null);
}

function handoffText(ctx, cfg, file) {
  return `[Budget contexte ${kTok(ctx)} (seuil passation ${kTok(cfg.handoffTokens)})] Écris maintenant la passation dans ${file} (format ci-dessous) puis continue ; propose /clear à la fin du lot en cours.\nFormat : ${SECTIONS} ; 60 lignes max.\nPour compacter sans perdre le fil, propose à l'utilisateur de coller cette ligne :\n${compactLineFor(file)}`;
}

function blockReason(ctx, cfg, file) {
  return `Ton message n'a pas été envoyé. Contexte ${kTok(ctx)} tokens (seuil blocage ${kTok(cfg.blockTokens)}). Écris la passation (dis « écris la passation ») puis lance /clear : elle sera rechargée automatiquement. Pour continuer quand même, renvoie-le (copie-le avant).\nOu, pour compacter en gardant le fil, colle cette ligne :\n${compactLineFor(file)}`;
}

function warningText(ctx, cfg) {
  return `[Budget contexte ${kTok(ctx)} (seuil blocage ${kTok(cfg.blockTokens)})] Contexte toujours au-dessus du seuil de blocage : termine la passation si elle n'est pas écrite, puis lance /clear.`;
}

// Retourne { output, json, state } : output = texte pour le contexte, json = decision de blocage.
function decide(input, config, state) {
  const st = normalize(state);
  const none = { output: null, json: null, state: st };
  if (process.env.CONTEXT_BUDGET === 'off') return none;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return none;
  const m = measure(input.transcript_path);
  if (!m) return none;

  const cfg = config.contextBudget;
  const s = Object.assign({}, st);
  // Chute de plus de 30 % par rapport au dernier mesure (compaction, clear) : les niveaux sont re-armes.
  if (s.lastCtx !== null && m.ctx < s.lastCtx * (1 - RESET_DROP)) {
    s.level = 'none';
    s.blocked = false;
  }
  s.lastCtx = m.ctx;
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const file = handoffPath(input.cwd, config);

  if (m.ctx >= cfg.blockTokens) {
    // Demande explicite de passation : le texte est donne sur demande, sans bloquer.
    if (PASSATION_RE.test(prompt)) {
      if (s.level !== 'warn') s.level = 'block';
      return { output: handoffText(m.ctx, cfg, file), json: null, state: s };
    }
    // Blocage une seule fois par cycle de contexte (re-arme seulement sur chute, voir RESET_DROP).
    if (!s.blocked) {
      s.level = 'block';
      s.blocked = true;
      return { output: null, json: { decision: 'block', reason: blockReason(m.ctx, cfg, file) }, state: s };
    }
    // Apres le blocage : un seul avertissement, puis rien tant que le contexte reste au-dessus du seuil.
    if (s.level === 'warn') return { output: null, json: null, state: s };
    s.level = 'warn';
    return { output: warningText(m.ctx, cfg), json: null, state: s };
  }

  // Chaque niveau n'est annonce qu'une fois : on ne repete le texte qu'en cas de hausse.
  const level = m.ctx >= cfg.handoffTokens ? 'handoff' : m.ctx >= cfg.delegateTokens ? 'delegate' : 'none';
  if (RANK[level] <= RANK[s.level]) return { output: null, json: null, state: s };
  s.level = level;
  return { output: level === 'handoff' ? handoffText(m.ctx, cfg, file) : delegateText(m.ctx, cfg), json: null, state: s };
}

// Identifiant de session assaini : aucun caractere de chemin.
function statePath(stateDir, sessionId) {
  const sid = typeof sessionId === 'string' && sessionId ? sessionId : 'default';
  return path.join(stateDir, 'ctx-' + sid.replace(/[^A-Za-z0-9_-]/g, '_') + '.json');
}

function readState(file) {
  try {
    return normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    return freshState();
  }
}

function writeState(file, st) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(st));
}

// Lit l'etat, decide, ecrit l'etat s'il a change. Utilise par main et les tests.
function run(input, config) {
  const sid = input && typeof input === 'object' ? input.session_id : undefined;
  const file = statePath(stateDirOf(config), sid);
  const before = readState(file);
  const res = decide(input, config, before);
  if (JSON.stringify(res.state) !== JSON.stringify(before)) {
    try { writeState(file, res.state); } catch (e) { /* etat perdu : la sortie reste envoyee */ }
  }
  return res;
}

// Sortie du hook sans I/O (appele par dispatch.js) : blocage JSON, texte, ou rien. Fail-open.
function hook(raw) {
  let stdout = '';
  try {
    const res = run(JSON.parse(raw), loadConfig());
    stdout = res.json ? JSON.stringify(res.json) : res.output || '';
  } catch (e) { /* fail-open */ }
  return { stdout, stderr: '', exitCode: 0 };
}

function main() {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const res = run(input, loadConfig());
    if (res.json) process.stdout.write(JSON.stringify(res.json));
    else if (res.output) process.stdout.write(res.output);
  } catch (e) { /* fail-open */ }
  process.exitCode = 0;
}

module.exports = { measure, decide, run, statePath, compactLine, readTail, hook };
if (require.main === module) main();
