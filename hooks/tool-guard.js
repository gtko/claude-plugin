// PreToolUse (tous outils) : garde-fous d'economie de contexte et de tokens.
// Budget d'appels par sous-agent (avertissement a 80 %, grace de finition), anti-boucle,
// lectures/recherches/sorties trop larges, et refus des commandes destructrices
// (toolGuard.denyCommands : refus absolu, avant tout compte, non contournable par relance).
// Fail-open : toute exception -> exit 0 sans decision.
// Exporte decide(input, config) et decideFull(input, config) pour les tests ;
// ne s'execute que s'il est lance directement.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { bare } = require('./lib/agent-name.js');
const { expandConfigPath, hookStateDir } = require('./lib/paths.js');
const { loadConfig } = require('./lib/config.js');

const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit'];
// Appels qui modifient l'etat (edition, sous-agent) : l'historique anti-boucle repart de zero.
const RESET_TOOLS = [...EDIT_TOOLS, 'Agent', 'Task'];
// Outils d'attente/suivi : hors anti-boucle (ni comptes, ni ajoutes a l'historique).
const LOOP_EXEMPT = ['TaskOutput', 'TaskStop', 'Monitor', 'ScheduleWakeup', 'TodoWrite', 'TaskUpdate', 'TaskCreate', 'TaskList'];
const SHELL_TOOLS = ['Bash', 'PowerShell'];
const BYPASSABLE = ['read', 'search', 'output'];
const BINARY_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.pdf', '.ipynb'];
const SEARCH_FAMILIES = ['main', 'opus'];
const DELEGATE_FAMILIES = ['main', 'opus', 'sonnet'];
const GLOB_ALL = ['**', '**/*', '**/*.*'];
const CLEANUP_EVERY = 20;
const BIG_FILE_BYTES = 2 * 1024 * 1024;
const RANGE_DEFAULT_LIMIT = 2000;
const WARN_BUDGET = "[tool-guard] 80 % du budget d'appels utilisé : termine, vérifie, commit et prépare ton rapport.";

const PIPE_FILTER = /\|\s*(?:head|tail|grep|rg|findstr|jq|wc|less|more|select-object|select-string|out-null|measure-object)\b/i;
// Redirection de stdout (> ou >>) vers un fichier. Pas 2>, pas 2>&1, pas ->, pas >&.
const STDOUT_FILE = /(?:^|[\s;&|(])1?>>?(?!&)\s*[^\s&|;>]/;
const TEST_CMD = /(?:^|[\s;&(|])(?:(?:npm|pnpm|yarn)\s+(?:run\s+)?test(?::\S+)?|vitest|jest|node\s+--test)(?=\s|$|[;&)|])/i;
const TEST_QUIET = /--(?:test-)?reporter\b|--silent\b|(?:^|\s)-q(?=\s|$)/;
const TEST_TARGET = /\.[cm]?[jt]sx?$/;
const GIT_LOG = /\bgit(?:\s+-C\s+\S+)?\s+log\b/;
const GIT_LOG_LIMIT = /(?:^|\s)-n(?=\s|\d|$)|(?:^|\s)-\d+\b|--max-count\b|--since\b|--after\b|\S+\.\.\S*/;
const GIT_FINISH = /^git(?:\s+-C\s+\S+)?\s+(?:status|diff|log|add|commit|rev-parse|show)\b/i;
const FILE_CMD = /(?:^|[;&|(\r\n]\s*)(cat|type|get-content)\s+([^;&|\r\n]+)/i;
const PS_RANGE = /-(?:totalcount|tail|first)\b/i;

const MSG = {
  budget: (n, left) => `Budget d'outils atteint (${n} appels) : arrête-toi et rends ton rapport maintenant (fait / reste à faire / ESCALATE: si besoin).${left > 0 ? ` Encore ${left} appel(s) git de finition autorisé(s) : git -C <dossier> status/diff/add/commit (pas de cd &&).` : ''}`,
  loop: (n) => `Même appel répété ${n} fois : change d'approche, ou réponds ESCALATE: avec ce que tu as appris. Fais un autre appel (ou modifie le code) avant de relancer.`,
  read: (n, family) => `Fichier de ${n} lignes lu en entier : lis une plage (offset/limit) ciblée${DELEGATE_FAMILIES.includes(family) ? ', ou demande une synthèse à haiku-tools' : ''}. Relance à l'identique pour forcer.`,
  readHuge: (family) => `Fichier de plus de 2 Mo lu en entier : lis une plage (offset/limit) ciblée${DELEGATE_FAMILIES.includes(family) ? ', ou demande une synthèse à haiku-tools' : ''}. Relance à l'identique pour forcer.`,
  range: (limit, cap) => `Plage trop large (limit ${limit}, max ${cap}) : réduis limit ou relance à l'identique pour forcer.`,
  search: "Recherche trop large : restreins path/glob/type ou délègue à haiku-tools. Relance à l'identique pour forcer.",
  output: "Sortie potentiellement énorme : filtre (ex. `| tail -40`, `--reporter=dot`, `git log -n 20`) ou délègue à haiku-tools. Relance à l'identique pour forcer.",
};

// Dossier d'etat : stateDir de hooks-config.json (~/.claude suit CLAUDE_CONFIG_DIR), sinon <configDir>/hook-state.
function stateDirOf(cfg) {
  return cfg.stateDir ? expandConfigPath(cfg.stateDir) : hookStateDir();
}

// Type d'agent sans prefixe de plugin ("gtko-agents:haiku-builder" -> "haiku-builder") ; '' si absent.
function agentTypeOf(input) {
  return bare(typeof input.agent_type === 'string' ? input.agent_type : '');
}

// Famille de l'appelant : main, haiku, sonnet, opus ou default.
function familyOf(input) {
  if (!input.agent_id) return 'main';
  const t = agentTypeOf(input);
  if (t.startsWith('haiku-')) return 'haiku';
  if (t.startsWith('sonnet-')) return 'sonnet';
  if (t.startsWith('opus-')) return 'opus';
  return 'default';
}

// Valeur par famille, avec repli sur default.
function pick(map, family) {
  if (!map) return undefined;
  return map[family] !== undefined ? map[family] : map.default;
}

// Budget : type d'agent exact d'abord, puis famille, puis default.
function budgetOf(budgets, input, family) {
  if (!budgets) return undefined;
  const t = agentTypeOf(input);
  if (t && Object.prototype.hasOwnProperty.call(budgets, t)) return budgets[t];
  return pick(budgets, family);
}

// JSON stable : cles triees, pour que le hash ne depende pas de l'ordre.
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  const s = JSON.stringify(v);
  return s === undefined ? 'null' : s;
}

// Bash/PowerShell : seule la commande compte (pas la description).
function hashCall(tool, ti) {
  const key = SHELL_TOOLS.includes(tool)
    ? { command: ti.command, run_in_background: ti.run_in_background }
    : ti;
  return crypto.createHash('sha1').update(tool + stable(key)).digest('hex');
}

// Remplace le contenu des guillemets par des x (meme longueur) : les tests de forme ne le voient pas.
// PowerShell : le masquage suit sa tokenisation (\ n'échappe rien, ` échappe, "" se double) ; sinon Bash.
function maskQuoted(s, tool) {
  if (tool === 'PowerShell') {
    return s.replace(QUOTES_PS, (m) => (m[0] === '`' ? m : m[0] + 'x'.repeat(m.length - 2) + m[0]));
  }
  return s.replace(/"[^"]*"|'[^']*'/g, (m) => m[0] + 'x'.repeat(m.length - 2) + m[0]);
}

function stateFileOf(cfg, input) {
  const sid = input.session_id != null ? String(input.session_id) : 'nosession';
  const who = input.agent_id ? String(input.agent_id) : 'main';
  const name = (sid + '__' + who).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 200) + '.json';
  return path.join(stateDirOf(cfg), name);
}

function emptyState() {
  return { count: 0, history: [], lastDenied: null, warned: false };
}

function readState(file) {
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!s || typeof s !== 'object') throw new Error('etat invalide');
  return {
    count: Number.isFinite(s.count) ? s.count : 0,
    history: Array.isArray(s.history) ? s.history : [],
    lastDenied: s.lastDenied && typeof s.lastDenied === 'object' ? s.lastDenied : null,
    warned: s.warned === true,
  };
}

// Une nouvelle tentative si le JSON est illisible, puis etat vide (fail-open).
function loadState(file) {
  for (let i = 0; i < 2; i++) {
    try {
      return readState(file);
    } catch (e) {
      if (e && e.code === 'ENOENT') break;
    }
  }
  return emptyState();
}

// Ecriture atomique : fichier temporaire propre au process, puis rename.
function saveState(file, st) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(st));
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* rien a nettoyer */ }
  }
}

// Supprime les etats de session plus vieux que maxAgeMs.
function cleanupOld(dir, maxAgeMs) {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const p = path.join(dir, f);
      try {
        if (now - fs.statSync(p).mtimeMs > maxAgeMs) fs.unlinkSync(p);
      } catch (e) { /* ignore */ }
    }
  } catch (e) { /* dossier absent */ }
}

// Nombre de lignes d'un fichier, lu par blocs (pas de chargement complet en memoire).
function countLines(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(65536);
    let n = 0;
    let last = -1;
    let got;
    while ((got = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      for (let i = 0; i < got; i++) if (buf[i] === 10) n++;
      last = buf[got - 1];
    }
    return last === -1 || last === 10 ? n : n + 1;
  } finally {
    fs.closeSync(fd);
  }
}

// Lignes d'un fichier, ou null si plus de 2 Mo (gros : pas de comptage).
function lineCount(abs, size) {
  return size > BIG_FILE_BYTES ? null : countLines(abs);
}

function samePath(a, b) {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

// Chemin absent, ou egal a la racine du projet (cwd).
function atOrAbsent(p, base) {
  return !p || samePath(path.resolve(base, String(p)), base);
}

function checkRead(ti, base, family, tg) {
  const file = ti.file_path;
  if (typeof file !== 'string' || !file) return null;
  if (BINARY_EXT.includes(path.extname(file).toLowerCase())) return null;
  const max = pick(tg.readMaxLines, family);
  if (ti.offset != null || ti.limit != null) {
    // offset sans limit : la lecture part sur la limite par defaut (2000 lignes)
    const limit = ti.limit != null ? Number(ti.limit) : RANGE_DEFAULT_LIMIT;
    const cap = Math.max(Number(tg.rangeMaxLines) || 0, Number(max) || 0);
    if (limit > cap) return { kind: 'read', reason: MSG.range(limit, cap) };
    return null;
  }
  const abs = path.resolve(base, file);
  let st;
  try { st = fs.statSync(abs); } catch (e) { return null; }
  if (!st.isFile() || st.size <= (tg.sizeCheckBytes ?? 20000)) return null;
  const n = lineCount(abs, st.size);
  if (n === null) return { kind: 'read', reason: MSG.readHuge(family) };
  return n > max ? { kind: 'read', reason: MSG.read(n, family) } : null;
}

function checkSearch(tool, ti, base, family) {
  if (!SEARCH_FAMILIES.includes(family)) return null;
  if (tool === 'Grep') {
    const wide = ti.output_mode === 'content' && ti.head_limit == null && !ti.glob && !ti.type;
    return wide && atOrAbsent(ti.path, base) ? { kind: 'search', reason: MSG.search } : null;
  }
  if (GLOB_ALL.includes(ti.pattern) && atOrAbsent(ti.path, base)) {
    return { kind: 'search', reason: MSG.search };
  }
  return null;
}

// cat / type / Get-Content sur un fichier plus long que le seuil de la famille.
function bigFileShown(cmd, masked, base, family, tg) {
  const m = FILE_CMD.exec(cmd);
  if (!m) return false;
  if (m[1].toLowerCase() !== 'cat' && PS_RANGE.test(masked)) return false;
  const max = pick(tg.readMaxLines, family);
  const files = m[2].trim().split(/\s+/).filter((t) => t && !t.startsWith('-'));
  return files.some((t) => {
    const abs = path.resolve(base, t.replace(/^["']|["']$/g, ''));
    try {
      const st = fs.statSync(abs);
      if (!st.isFile()) return false;
      const n = lineCount(abs, st.size);
      return n === null || n > max;
    } catch (e) { return false; }
  });
}

// Vrai si la commande de test cible un fichier ou un chemin (argument apres la commande).
function testTargets(cmd, masked, m) {
  const start = m.index + m[0].length;
  const len = masked.slice(start).split(/[;&|\r\n]/)[0].length;
  return cmd.slice(start, start + len).split(/\s+/)
    .some((t) => TEST_TARGET.test(t.replace(/^["']|["']$/g, '')));
}

function checkOutput(ti, base, family, tg) {
  const cmd = typeof ti.command === 'string' ? ti.command : '';
  if (!cmd) return null;
  const masked = maskQuoted(cmd);
  if (PIPE_FILTER.test(masked) || STDOUT_FILE.test(masked)) return null;
  const test = TEST_CMD.exec(masked);
  const big = (GIT_LOG.test(masked) && !GIT_LOG_LIMIT.test(masked.replace(/\s-C\s+\S+/, ' ')))
    || (test !== null && !TEST_QUIET.test(masked) && !testTargets(cmd, masked, test))
    || bigFileShown(cmd, masked, base, family, tg);
  return big ? { kind: 'output', reason: MSG.output } : null;
}

function guardFor(tool, ti, base, family, tg) {
  if (tool === 'Read') return checkRead(ti, base, family, tg);
  if (tool === 'Grep' || tool === 'Glob') return checkSearch(tool, ti, base, family);
  if (SHELL_TOOLS.includes(tool)) return checkOutput(ti, base, family, tg);
  return null;
}

// Commande de finition (grace) : chaque segment doit etre une commande git autorisee.
function isFinishing(tool, ti) {
  if (!SHELL_TOOLS.includes(tool)) return false;
  const cmd = typeof ti.command === 'string' ? maskQuoted(ti.command, tool) : '';
  const segs = cmd.replace(/\d*>&\d*/g, ' ').split(/&&?|\|\|?|[;\r\n]/)
    .map((s) => s.trim()).filter(Boolean);
  return segs.length > 0 && segs.every((s) => GIT_FINISH.test(s));
}

// Heredoc : opérateur << hors guillemets (délimiteur, forme <<- avec tabulations).
// Le délimiteur commence par une lettre ou _ : sinon c'est un décalage arithmétique ($((1<<2))).
// Échappements (\x) et guillemets doubles tiennent compte de \" : un << dans une chaîne ou après \ n'ouvre pas de heredoc.
const HEREDOC_OP = /\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|'[^']*'|(?<!<)<<(?!<)(-?)\s*(["']?)([A-Za-z_][^\s'"<>|;&()]*)\2/g;
// Mot shell : la commande exécute ce qu'on lui passe (bash <<EOF, cat x | sh).
const SHELL_WORD = /(?:^|[\s;&|(])(?:bash|sh|zsh|pwsh|powershell|cmd|eval|source|xargs)(?:\.exe)?(?=\s|$)/i;
// Arguments entre guillemets des wrappers shell. Chaque forme tokenise ses guillemets à sa façon :
//  - bash, sh, zsh (avec -c) et eval : \ échappe dans "...", ` reste un caractère ordinaire ;
//  - pwsh, powershell : \ n'échappe rien ; dans "..." un guillemet se double ("") et ` échappe ; -Command est facultatif (positionnel) ;
//  - cmd (/c ou /k) : aucun échappement ;
//  - Start-Process <shell> -ArgumentList : chaque chaîne de la liste est une ligne de commande du shell.
// Le wrapper suit un début, un séparateur, une parenthèse, un guillemet ou un \ ou / (chemin : "C:\...\pwsh.exe", /usr/bin/bash).
// Groupe 1 : wrapper (absent pour eval) ; groupe 2 : contenu entre guillemets doubles ; groupe 3 : entre simples.
const SHELL_ARG_POSIX = /(?:^|[\s;&|(\\/"'])(?:((?:bash|sh|zsh)(?:\.exe)?)["']?\s+(?:-[a-z]+(?:\s+[a-z]\w*)?\s+)*?-[a-z]*c|eval)\s+(?:"((?:\\[\s\S]|""|[^"\\])*)"|'([^']*)')/gi;
const SHELL_ARG_PS = /(?:^|[\s;&|(\\/"'])((?:pwsh|powershell)(?:\.exe)?)["']?\s+(?:-[a-z]+(?:\s+[a-z]\w*)?\s+)*?(?:-command\s+)?(?:"((?:\x60[\s\S]|""|[^"\x60])*)"|'((?:''|[^'])*)')/gi;
// cmd : groupe 1 le wrapper, groupe 2 le contenu entre guillemets doubles (sans échappement).
const SHELL_ARG_CMD = /(?:^|[\s;&|(\\/"'])((?:cmd)(?:\.exe)?)["']?\s+(?:\/[a-z]\s+)*?\/[ck]\s+"([^"]*)"/gi;
// Contenu d'une chaîne PowerShell : "" vaut ", ` échappe le caractère suivant ; '' vaut ' (chaîne simple).
const psDq = (s) => s.replace(/""/g, '"').replace(/`([\s\S])/g, '$1');
const psSq = (s) => s.replace(/''/g, "'");
// Start-Process <shell> -ArgumentList "...", '...' : une passe linéaire sur les mots et les guillemets.
// Les chaînes de la liste sont des lignes de commande du shell (PowerShell : "" et ` ; '' pour les simples).
// Guillemet non fermé : la commande ne tourne pas (erreur de syntaxe) ; le reste est examiné comme argument, par prudence.
const SHELL_NAME = /(?:^|[\\/])(?:pwsh|powershell|cmd|bash|sh|zsh)(?:\.exe)?$/i;
const START_TOKEN_RE = /[^\s;&|()"'\r\n]+|[;&|\r\n]|["']/g;
// Position du guillemet fermant (q ouvert en i), ou -1 : une seule avance, donc temps linéaire.
function closingQuote(s, i, q) {
  let j = i + 1;
  while (j < s.length) {
    const ch = s[j];
    if (q === '"' && ch === '`') j += 2;
    else if (ch === q) {
      if (s[j + 1] === q) j += 2;
      else return j;
    } else j += 1;
  }
  return -1;
}
function startArgSegments(body) {
  const out = [];
  let started = false; // start / Start-Process vu dans l'instruction
  let shell = false; // nom de shell (ou chemin entre guillemets) vu après Start-Process
  let args = false; // dans -ArgumentList : les chaînes sont des lignes de commande
  START_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = START_TOKEN_RE.exec(body)) !== null) {
    const t = m[0];
    if (t === '"' || t === "'") {
      const end = closingQuote(body, m.index, t);
      const raw = end < 0 ? body.slice(m.index + 1) : body.slice(m.index + 1, end);
      const val = t === '"' ? psDq(raw) : psSq(raw);
      if (args) out.push(...splitSegments(val));
      else if (started && SHELL_NAME.test(val)) shell = true;
      if (end < 0) break;
      START_TOKEN_RE.lastIndex = end + 1;
    } else if (t === ';' || t === '&' || t === '|' || t === '\r' || t === '\n') {
      started = false; shell = false; args = false;
    } else if (/^start(?:-process)?$/i.test(t)) {
      started = true; shell = false; args = false;
    } else if (/^-argumentlist$/i.test(t)) {
      args = started && shell;
    } else if (started && SHELL_NAME.test(t)) {
      shell = true;
    }
  }
  return out;
}
// Échappements des guillemets doubles (bash : \" \$ \` \\) : retirés pour examiner la commande telle qu'elle s'exécute.
const DQ_ESCAPE = /\\(["$`\\])/g;
// Longueur max d'un segment examiné ; au-delà, le segment est tronqué.
const SEG_MAX = 16384;
// Début de commande (après un séparateur ou une parenthèse) : son texte entre guillemets est exécuté.
const CMD_START = /(?:^|[;&|(`\r\n])\s*$/;
// Juste après -C : chemin du dépôt, gardé visible pour la résolution de branche.
const GIT_C_BEFORE = /-C\s+$/i;

// Motifs de guillemets selon l'outil. Bash : \ échappe ; "..." et '...' n'ont pas d'échappement interne.
// PowerShell : ` échappe ; dans "..." et '...' un guillemet se double ("" et ''), \ n'échappe rien ;
// “ ” „ et ‘ ’ ‚ ‛ sont aussi des guillemets (ils ouvrent ou ferment une chaîne).
const QUOTES_BASH = /\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|'[^']*'/g;
const QUOTES_PS = /`[\s\S]|["“”„](?:`[\s\S]|""|[^"“”„`])*["“”„]|['‘’‚‛](?:''|[^'‘’‚‛])*['‘’‚‛]/g;

// Chaîne entre guillemets doubles qui s'exécute en partie : "$(...)" (Bash et PowerShell), "`...`" (Bash seulement).
// Elle n'est pas masquée : splitSegments coupe sur ( et ` et son contenu devient un segment examiné.
const DQ_OPEN = /^["“”„]/;
function substitutes(m, tool) {
  if (!DQ_OPEN.test(m)) return false;
  const inner = m.slice(1, -1);
  return inner.includes('$(') || (tool !== 'PowerShell' && inner.includes('`'));
}

// Texte entre guillemets qui contient un espace : masqué (un echo ou un message n'est pas exécuté).
// Visible : début de commande ("C:\Program Files\...\git.exe" push) et argument de -C.
// Un mot seul entre guillemets ("$HOME", "C:\") reste visible aux motifs.
function maskPhrases(s, tool) {
  return s.replace(tool === 'PowerShell' ? QUOTES_PS : QUOTES_BASH, (m, off, str) => {
    // Échappement hors guillemets (\" \' \; en Bash, `" en PowerShell) : jamais masqué, il reste visible aux motifs.
    if (m[0] === '\\' || m[0] === '`') return m;
    if (substitutes(m, tool)) return m;
    const before = str.slice(0, off);
    if (!/\s/.test(m.slice(1, -1)) || CMD_START.test(before) || GIT_C_BEFORE.test(before)) return m;
    return m[0] + 'x'.repeat(m.length - 2) + m[0];
  });
}

// Segments d'une commande : && || ; | & parentheses, backtick et retour ligne. 2>&1 et &> ne coupent pas.
function splitSegments(s) {
  return s.replace(/\d*>&\d*/g, ' ').replace(/&>>?/g, ' ')
    .split(/&&|\|\||[;&|()`\r\n]/).map((x) => x.trim()).filter(Boolean);
}

// Corps de heredoc retirés (donnée), sauf si un shell les exécute (bash <<EOF). Opérateur entre guillemets ignoré.
function stripHeredocs(cmd) {
  if (!cmd.includes('<<')) return cmd;
  const out = [];
  const pending = [];
  for (const line of cmd.split('\n')) {
    if (pending.length) {
      const h = pending[0];
      const probe = (h.tabs ? line.replace(/^\t+/, '') : line).replace(/\r$/, '');
      if (probe === h.delim) pending.shift();
      if (h.keep) out.push(line);
      continue;
    }
    out.push(line);
    for (const m of line.matchAll(HEREDOC_OP)) {
      if (m[3] !== undefined) pending.push({ delim: m[3], tabs: m[1] === '-', keep: SHELL_WORD.test(line) });
    }
  }
  return out.join('\n');
}

// Arguments des wrappers shell, décodés selon leur forme (voir SHELL_ARG_POSIX), en segments à examiner.
function wrapperSegments(body) {
  const out = [];
  for (const m of body.matchAll(SHELL_ARG_POSIX)) {
    out.push(...splitSegments(m[2] !== undefined ? m[2].replace(DQ_ESCAPE, '$1') : m[3]));
  }
  for (const m of body.matchAll(SHELL_ARG_PS)) {
    out.push(...splitSegments(m[2] !== undefined ? psDq(m[2]) : psSq(m[3])));
  }
  for (const m of body.matchAll(SHELL_ARG_CMD)) out.push(...splitSegments(m[2]));
  // Sans -ArgumentList, pas de Start-Process à examiner (évite la passe de jetons sur toute commande).
  return /-argumentlist/i.test(body) ? out.concat(startArgSegments(body)) : out;
}

// Segments à examiner : texte masqué sans corps de heredoc, plus les arguments des wrappers shell.
// Heredoc : Bash seulement (en PowerShell, << n'ouvre pas de corps de donnée).
function denySegments(cmd, tool) {
  const body = tool === 'Bash' ? stripHeredocs(cmd) : cmd;
  return splitSegments(maskPhrases(body, tool)).concat(wrapperSegments(body));
}

// Regex d'une règle, compilée une seule fois (insensible à la casse) ; invalide -> null (ignorée).
const regexCache = new Map();
function compileRule(rule) {
  if (!rule || typeof rule.pattern !== 'string') return null;
  if (!regexCache.has(rule.pattern)) {
    let re = null;
    try { re = new RegExp(rule.pattern, 'i'); } catch (e) { re = null; }
    regexCache.set(rule.pattern, re);
  }
  return regexCache.get(rule.pattern);
}

// Branche courante du dépôt (git -C <dir> symbolic-ref --short HEAD). Null si indisponible : fail-open.
const branchCache = new Map();
function currentBranch(dir) {
  if (!branchCache.has(dir)) {
    let name = null;
    try {
      const r = spawnSync('git', ['-C', dir, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8', timeout: 2000, windowsHide: true });
      if (r.status === 0 && typeof r.stdout === 'string' && r.stdout.trim()) name = r.stdout.trim();
    } catch (e) { name = null; }
    branchCache.set(dir, name);
  }
  return branchCache.get(dir);
}

// Première règle qui correspond à un segment de la commande : { reason, hint } ou null.
// ifCurrentBranch : la règle ne s'applique que si la branche courante (dépôt de -C ou cwd) est dans la liste.
function denyRule(cmd, rules, base, tool) {
  if (typeof cmd !== 'string' || !cmd || !Array.isArray(rules)) return null;
  const segs = denySegments(cmd, tool).map((s) => (s.length > SEG_MAX ? s.slice(0, SEG_MAX) : s));
  for (const rule of rules) {
    const re = compileRule(rule);
    if (!re) continue;
    for (const seg of segs) {
      if (!re.test(seg)) continue;
      if (Array.isArray(rule.ifCurrentBranch)) {
        const m = /(?:^|\s)-C\s+(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(seg);
        const dir = m ? path.resolve(base, m[1] ?? m[2] ?? m[3]) : base;
        const branch = currentBranch(dir);
        if (!branch || !rule.ifCurrentBranch.includes(branch)) continue;
      }
      return rule;
    }
  }
  return null;
}

const NONE = () => ({ reason: null, context: null });

// Retourne { reason, context } : reason = refus (string) ou null ; context = avertissement a transmettre.
function decideFull(input, config) {
  if (process.env.TOOL_GUARD === 'off') return NONE();
  if (!input || typeof input !== 'object' || typeof input.tool_name !== 'string') return NONE();
  const cfg = config || loadConfig();
  const tg = cfg.toolGuard || {};
  const tool = input.tool_name;
  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};

  const family = familyOf(input);
  const base = input.cwd ? String(input.cwd) : process.cwd();

  // 0. commandes destructrices : refus absolu, avant tout compte (ni relance, ni budget, ni boucle)
  if (SHELL_TOOLS.includes(tool) && process.env.DENY_LIST !== 'off') {
    const rule = denyRule(ti.command, tg.denyCommands, base, tool);
    if (rule) {
      const hint = rule.hint ? ` Alternative : ${rule.hint}.` : '';
      return { reason: `commande destructrice refusée : ${rule.reason || 'commande destructrice'}.${hint} Si c'est voulu, l'utilisateur la lance lui-même avec \`! <commande>\`. Ne la contourne pas (autre syntaxe, script, alias) : demande à l'utilisateur.`, context: null };
    }
  }
  const hash = hashCall(tool, ti);
  const keep = tg.repeatWindow ?? 15;
  const file = stateFileOf(cfg, input);
  const st = loadState(file);

  st.count += 1;
  if (st.count % CLEANUP_EVERY === 0) {
    cleanupOld(stateDirOf(cfg), (cfg.stateMaxAgeHours ?? 48) * 3600 * 1000);
  }

  const deny = (reason) => {
    saveState(file, st);
    return { reason, context: null };
  };

  // Appel passe : seul un appel reellement execute entre dans l'historique.
  let warnDue = false;
  const pass = (push) => {
    let context = null;
    if (warnDue) {
      st.warned = true;
      context = WARN_BUDGET;
    }
    if (RESET_TOOLS.includes(tool)) {
      st.history = [];
    } else if (push && !LOOP_EXEMPT.includes(tool)) {
      st.history.push(hash);
      if (st.history.length > keep) st.history = st.history.slice(-keep);
    }
    saveState(file, st);
    return { reason: null, context };
  };

  // 1. budget d'appels (sous-agents seulement) : refus non contournable
  if (input.agent_id) {
    const budget = budgetOf(tg.budgets, input, family);
    if (budget !== undefined) {
      const grace = Number(tg.budgetGrace) || 0;
      if (st.count > budget) {
        if (st.count > budget + grace || !isFinishing(tool, ti)) return deny(MSG.budget(st.count, Math.max(0, budget + grace - st.count)));
      } else if (!st.warned && st.count >= Math.ceil(budget * (tg.budgetWarnAt ?? 0.8))) {
        warnDue = true;
      }
    }
  }

  // 2. anti-boucle : refus si les (repeatLimit-1) dernieres entrees sont le hash courant
  const need = (tg.repeatLimit ?? 3) - 1;
  if (!LOOP_EXEMPT.includes(tool) && need >= 1 && st.history.length >= need
      && st.history.slice(-need).every((h) => h === hash)) {
    return deny(MSG.loop(need + 1));
  }

  // 3. relance deliberee (identique) d'un refus contournable : passage force, pas d'historique
  if (st.lastDenied && st.lastDenied.hash === hash && BYPASSABLE.includes(st.lastDenied.kind)) {
    st.lastDenied = null;
    return pass(false);
  }

  // 4. garde-fous contournables (lecture, recherche, sortie)
  const guard = guardFor(tool, ti, base, family, tg);
  if (guard) {
    st.lastDenied = { hash, kind: guard.kind };
    return deny(guard.reason);
  }
  return pass(true);
}

// Retourne null (laisser passer) ou une raison de refus (string).
function decide(input, config) {
  return decideFull(input, config).reason;
}

// Sortie du hook sans I/O (appele par dispatch.js) : refus, avertissement de contexte, ou rien. Fail-open.
function hook(raw) {
  let stdout = '';
  try {
    const input = JSON.parse(raw);
    const { reason, context } = decideFull(input);
    if (reason) {
      stdout = JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: '[tool-guard] ' + reason,
        },
      });
    } else if (context) {
      stdout = JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context },
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
}

if (require.main === module) main();
module.exports = { decide, decideFull, hook };
