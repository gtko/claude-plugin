// PreToolUse (matcher Bash|PowerShell) : garde-fou du process de livraison (ODY-128).
// Refuse git commit / gh pr create / gh pr merge / deploiement qui sortent du process :
// branche sans cle d'issue (ou main/master), issue Linear inexistante, PR sans cle d'issue,
// review 4 axes absente ou perimee (ou review rapide, voie rapide ODY-130 : petit diff hors chemins sensibles),
// checks en echec, deploiement hors main a jour.
// Ne reagit qu'aux commandes concernees : le reste passe sans aucun appel externe.
// Dossier effectif : replay des cd / Set-Location / pushd precedant la commande, sous-shells (...) compris
// (pile de dossiers ; chemin variable : fail-open).
// Depots exclus (processGate.excludeRepos) : aucun controle. Echeance globale par appel (fail-open).
// Interrupteur : PROCESS_GATE=off. Fail-open : toute exception -> exit 0 sans decision.
// Les appels externes (git, gh, Linear) passent par `deps` (injectable) :
// exporte decide(input, config, deps) pour les tests ; ne s'execute que s'il est lance directement.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadConfig } = require('./lib/config.js');
const { expandConfigPath } = require('./lib/paths.js');

const SHELL_TOOLS = ['Bash', 'PowerShell'];
const LINEAR_URL = 'https://api.linear.app/graphql';
const LINEAR_TIMEOUT_MS = 5000;
const CMD_TIMEOUT_MS = 8000;
const GLOBAL_TIMEOUT_MS = 15000;
const REVIEW_MARKER = '<!-- review-4-axes -->';
const FAST_MARKER = '<!-- review-rapide -->';
// Review rapide : une ligne « Tests : <commandes et resultat> » (espaces seulement, pas de saut de ligne).
const FAST_TESTS_RE = /^Tests[ \t]*:[ \t]*\S/m;
const BASE_BRANCHES = ['main', 'master'];
// Valeurs de `gh pr checks --json bucket` qui comptent comme echec (pending = 8 : ignore).
const FAILING_BUCKETS = ['fail', 'cancel'];
// Options de `gh pr merge` qui prennent une valeur (le jeton suivant n'est pas la PR).
const MERGE_VALUE_FLAGS = ['-R', '--repo', '-t', '--subject', '-b', '--body', '-F', '--body-file', '-A', '--author-email', '--match-head-commit'];
const DRIVE_RE = /^[A-Za-z]:[\\/]/;

const PG_DEFAULTS = {
  enabled: true,
  issueKeyPattern: 'ody-\\d+',
  deployPatterns: ['wrangler deploy\\b', 'deploy:worker\\b'],
  linearCacheTtlMinutes: 60,
  excludeRepos: [],
  // Voie rapide : petit diff hors chemins sensibles, review rapide au lieu de la review 4 axes.
  fastLane: {
    enabled: true,
    maxLines: 30,
    sensitivePaths: ['(^|/)hooks/', '(^|/)settings[^/]*\\.json$', '(^|/)\\.env', 'secret', 'auth', 'deploy', '(^|/)wrangler\\.(toml|jsonc?)$', '(^|/)\\.github/workflows/', '(^|/)agents/', '(^|/)CLAUDE\\.md$', '(^|/)skills/livraison/', '(^|/)package\\.json$', '(^|/)\\.npmrc$'],
  },
};

// Detection sur la commande masquee (contenu des guillemets remplace, longueur conservee).
// Options globales de git (-C dir, -c k=v, --no-pager, --git-dir=...) avant la sous-commande.
const GIT_COMMIT_RE = /\bgit(?:\s+-(?:-[\w-]+|[A-Za-z])(?:=[^\s;&|]+|\s+(?:"[^"]*"|'[^']*'|[^\s"'\-;&|][^\s;&|]*))?)*\s+commit(?![\w-])/g;
const PR_CREATE_RE = /\bgh\s+pr\s+create(?![\w-])/g;
const PR_MERGE_RE = /\bgh\s+pr\s+merge(?![\w-])/g;
// Valeurs lues sur le texte non masque (la valeur capturee est toujours en fin de motif).
const GIT_C_OPT_RE = /(?:^|\s)-C(?:=|\s+)("(?:[^"\\]|\\.)*"|'[^']*'|[^\s"'][^\s;&|]*)/g;
const PR_TEXT_FLAG_RE = /(?:^|\s)(?:--title|-t|--body|-b)(?:=|\s+)("(?:[^"\\]|\\.)*"|'[^']*'|\S+)/g;
const PR_BODY_FILE_RE = /(?:^|\s)(?:--body-file|-F)(?:=|\s+)("(?:[^"\\]|\\.)*"|'[^']*'|\S+)/g;
const FILL_RE = /(?:^|\s)(?:--fill|-f)(?=\s|$)/;
const DRY_RUN_RE = /(?:^|\s)--dry-run(?=\s|$)/;
// Changements de dossier : prefixes de bloc optionnels ({, !, then, do, else, elif), mot-cle (masque) puis
// argument lu sur le texte brut, jusqu'au prochain point de coupure. Groupe 1 : verbe, groupe 2 : reste de la piece.
const CD_PIECE_RE = /^\s*(?:(?:\{\s*|!\s+|(?:then|do|else|elif)\s+))*(cd|set-location|sl|pushd|push-location|popd|pop-location)(?![\w-])([\s\S]*)$/i;
const CD_ARG_RE = /^\s*(?:-(?:literal)?path\s+)?("[^"]*"|'[^']*'|[^\s-]\S*)?\s*$/i;
// Verbe -> effet : cd remplace le dossier, pushd l'empile puis remplace, popd le depile.
const CD_VERB = { cd: 'cd', 'set-location': 'cd', sl: 'cd', pushd: 'pushd', 'push-location': 'pushd', popd: 'popd', 'pop-location': 'popd' };
// Points de coupure du dossier effectif : separateurs (&& || ; | fins de ligne), parentheses (sous-shells)
// et accolade fermante (fin de bloc : le cd reste en vigueur apres elle, contrairement a une parenthese).
const CUT_RE = /&&|\|\||[;|\r\n()}]/g;

const MERGE_DEPLOY_HINT = ' Cet enchaînement contient gh pr merge : lance le déploiement séparément, depuis main à jour.';

function processGateConfig(cfg) {
  const pg = cfg.processGate || {};
  // fastLane fusionne champ par champ : une cle partielle garde les valeurs par defaut des autres.
  return { ...PG_DEFAULTS, ...pg, fastLane: { ...PG_DEFAULTS.fastLane, ...(pg.fastLane || {}) } };
}

function expandHome(p) {
  return String(p).replace(/^~(?=$|[\\/])/, os.homedir());
}

// Dossier d'etat commun aux hooks (cache Linear) ; a defaut, dossier temporaire.
function stateDirOf(cfg) {
  return cfg.stateDir ? expandConfigPath(cfg.stateDir) : os.tmpdir();
}

function maskQuoted(s) {
  return s.replace(/"[^"]*"|'[^']*'/g, (m) => m[0] + 'x'.repeat(m.length - 2) + m[0]);
}

const unquote = (s) => String(s).replace(/^["']|["']$/g, '');

function parseJson(s) {
  try { return JSON.parse(String(s || '')); } catch (e) { return null; }
}

// Cles d'issue presentes dans un texte, en majuscules.
function keysIn(text, pattern) {
  return (String(text).match(new RegExp(pattern, 'gi')) || []).filter(Boolean).map((k) => k.toUpperCase());
}

// Valeurs capturees : position trouvee sur le texte masque, texte lu sur le brut (meme longueur).
function rawValues(raw, masked, re) {
  return [...masked.matchAll(re)].map((m) => {
    const end = m.index + m[0].length;
    return raw.slice(end - m[1].length, end);
  });
}

// Texte qui suit la sous-commande, jusqu'au prochain separateur (; & | fin de ligne) : brut et masque.
function tailOf(c) {
  const start = c.at + c.m[0].length;
  const rest = c.masked.slice(start);
  const end = rest.search(/[;&|\r\n]|$/);
  return { raw: c.cmd.slice(start, start + end), masked: rest.slice(0, end) };
}

// Bornes [debut, fin[ du segment de la commande masquee qui contient `index`.
function segmentBounds(masked, index) {
  let start = 0;
  let end = masked.length;
  for (const m of masked.matchAll(/&&|\|\||[;|\r\n]/g)) {
    if (m.index < index) {
      start = m.index + m[0].length;
    } else {
      end = m.index;
      break;
    }
  }
  return [start, end];
}

// Chemin hote : ~, /c/... (Git Bash) -> C:/..., relatif a `base`. Null si variable, inconnu ou base inconnue.
function resolvePath(base, raw) {
  const p = unquote(raw);
  if (!p || p === '-' || /[$`%]/.test(p)) return null;
  let s = expandHome(p);
  const gitBash = /^\/([A-Za-z])(?=\/|$)/.exec(s);
  if (gitBash) s = `${gitBash[1].toUpperCase()}:/${s.slice(3)}`;
  const P = DRIVE_RE.test(s) || (base && DRIVE_RE.test(base)) ? path.win32 : path;
  if (P.isAbsolute(s)) return P.normalize(s);
  return base === null ? null : P.resolve(base, s);
}

// Dossier effectif a la position `index` : replay, dans l'ordre, des cd / Set-Location / pushd / popd precedents.
// Pile de sous-shells : chaque `(` sauvegarde le dossier courant et la pile pushd, chaque `)` les restaure, donc un
// cd ou un pushd ne deborde pas au-dela de sa parenthese. Pile pushd : pushd empile le dossier courant, popd le depile ;
// pile vide ou popd avec argument = dossier inconnu. Null si un changement de dossier est illisible ou une variable (fail-open).
function effectiveDirAt(base, index) {
  const head = base.masked.slice(0, index);
  const saved = [];
  let dir = base.baseCwd;
  let dirs = [];
  let start = 0;
  for (const cut of [...head.matchAll(CUT_RE), null]) {
    const end = cut ? cut.index : head.length;
    const sep = cut ? cut[0] : '';
    const kw = CD_PIECE_RE.exec(base.masked.slice(start, end));
    if (kw) {
      const verb = CD_VERB[kw[1].toLowerCase()];
      // Argument lu sur le texte brut. Un changement suivi d'une parenthese ouvrante (cd (cmd)) : dossier inconnu.
      const arg = CD_ARG_RE.exec(base.cmd.slice(end - kw[2].length, end));
      const known = Boolean(arg) && sep !== '(';
      if (verb === 'popd') {
        const back = known && arg[1] === undefined && dirs.length > 0;
        dir = back ? dirs.pop() : null;
        if (!back) dirs = [];
      } else {
        if (verb === 'pushd') dirs.push(dir);
        if (!known) dir = null;
        else if (arg[1] === undefined) dir = verb === 'pushd' ? null : os.homedir();
        else dir = resolvePath(dir, arg[1]);
      }
    }
    if (sep === '(') {
      saved.push({ dir, dirs: dirs.slice() });
    } else if (sep === ')' && saved.length) {
      ({ dir, dirs } = saved.pop());
    }
    start = end + sep.length;
  }
  return dir;
}

// Dossier de git : chaque `-C <dir>` s'applique en cascade depuis le dossier effectif. Null si variable.
function gitDirOf(c) {
  const end = c.at + c.m[0].length;
  let dir = c.cwd;
  for (const v of rawValues(c.cmd.slice(c.at, end), c.masked.slice(c.at, end), GIT_C_OPT_RE)) {
    dir = resolvePath(dir, v);
    if (dir === null) return null;
  }
  return dir;
}

// Appel reel (git / gh). Pas de prompt git ; statut null si lancement impossible ou timeout.
function runCommand(file, args, cwd, timeoutMs = CMD_TIMEOUT_MS) {
  const r = spawnSync(file, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (r.error) return { status: null, stdout: '' };
  return { status: r.status, stdout: r.stdout || '' };
}

// Appel reel a l'API GraphQL Linear. La cle n'est jamais journalisee.
async function linearQuery(apiKey, query, timeoutMs = LINEAR_TIMEOUT_MS) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(LINEAR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: apiKey },
      body: JSON.stringify({ query }),
      signal: ctl.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function defaultDeps() {
  return { env: process.env, now: () => Date.now(), run: runCommand, linear: linearQuery };
}

// Temps restant de l'echeance globale ; leve si elle est depassee (decide passe alors en fail-open).
function remainingMs(c) {
  const left = c.deadline - c.deps.now();
  if (left <= 0) throw new Error('echeance globale depassee');
  return left;
}

// Appel git/gh borne par le temps restant de l'echeance globale.
function sh(c, file, args, cwd) {
  return c.deps.run(file, args, cwd, Math.min(CMD_TIMEOUT_MS, remainingMs(c)));
}

// --- Cache Linear : positifs seulement (une issue trouvee reste valable le TTL) ---

function cacheFileOf(cfg, key) {
  return path.join(stateDirOf(cfg), 'process-gate-linear-' + key.replace(/[^A-Za-z0-9_.-]/g, '_') + '.json');
}

function cacheHit(file, now, ttlMs) {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    const age = now - c.checkedAt;
    return c.exists === true && Number.isFinite(age) && age >= 0 && age < ttlMs;
  } catch (e) {
    return false;
  }
}

function cacheWrite(file, now) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ exists: true, checkedAt: now }));
    fs.renameSync(tmp, file);
  } catch (e) { /* cache optionnel */ }
}

// --- Linear ---

const issueQuery = (key) => '{ issue(id: ' + JSON.stringify(key) + ') { identifier } }';

// 'found' | 'missing' | 'unknown' (erreur, cle invalide, format inattendu : fail-open).
function interpretLinear(json) {
  if (!json || typeof json !== 'object') return 'unknown';
  if (json.data && typeof json.data === 'object') {
    if (json.data.issue && json.data.issue.identifier) return 'found';
    if (json.data.issue === null) return 'missing';
  }
  if (Array.isArray(json.errors) && json.errors.some((e) => /not found/i.test(String(e && e.message)))) return 'missing';
  return 'unknown';
}

// 'skip' (pas de LINEAR_API_KEY) | 'found' | 'missing' | 'unknown'.
async function linearState(key, c) {
  const raw = c.deps.env.LINEAR_API_KEY;
  const apiKey = typeof raw === 'string' ? raw.trim() : '';
  if (!apiKey) return 'skip';
  const file = cacheFileOf(c.cfg, key);
  const now = c.deps.now();
  const ttlMs = (Number(c.pg.linearCacheTtlMinutes) || 0) * 60 * 1000;
  if (cacheHit(file, now, ttlMs)) return 'found';
  let json = null;
  try {
    json = await c.deps.linear(apiKey, issueQuery(key), Math.min(LINEAR_TIMEOUT_MS, remainingMs(c)));
  } catch (e) {
    return 'unknown';
  }
  const state = interpretLinear(json);
  if (state === 'found') cacheWrite(file, now);
  return state;
}

async function issueMissing(key, c) {
  return (await linearState(key, c)) === 'missing';
}

// --- Messages ---

const branchRefusal = (branch, action) =>
  `${action} refusé sur « ${branch || '(détachée)'} » : crée l'issue Linear et une branche feature/ody-XXX-… (main et master interdites, clé d'issue requise dans le nom de branche).`;
const missingIssue = (key) => `l'issue ${key} n'existe pas dans Linear : crée-la ou corrige la clé avant de continuer.`;
const REVIEW_MISSING = `review manquante ou périmée : poste la review 4 axes après le dernier commit (marqueur ${REVIEW_MARKER}, sections BUG, SECURITY, UX/UI, PERFORMANCE, Verdict : OK).`;
const REVIEW_MISSING_FAST = `${REVIEW_MISSING} Un petit diff hors chemins sensibles peut passer avec une review rapide (marqueur ${FAST_MARKER}, ligne « Tests : ... », Verdict : OK).`;

// --- Git / gh helpers ---

function currentBranch(c, dir) {
  const r = sh(c, 'git', ['branch', '--show-current'], dir);
  return r.status === 0 ? String(r.stdout).trim() : null;
}

// Cle d'issue de la branche ; null si main/master ou pas de cle.
function branchKey(branch, pattern) {
  if (BASE_BRANCHES.includes(branch)) return null;
  return keysIn(branch, pattern)[0] || null;
}

function revParse(c, ref) {
  const r = sh(c, 'git', ['rev-parse', ref], c.cwd);
  return r.status === 0 ? String(r.stdout).trim() : null;
}

// Sujet du dernier commit (pour gh pr create --fill).
function lastSubject(c) {
  const r = sh(c, 'git', ['log', '-1', '--format=%s'], c.cwd);
  return r.status === 0 ? String(r.stdout).trim() : '';
}

// Contenu d'un fichier (--body-file) ; illisible = vide (la clé doit alors figurer dans --title).
function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return ''; }
}

// Jetons d'une commande gh pr merge : numero/URL de PR (premier positionnel) et depot -R.
function mergeTarget(args) {
  const tokens = (args.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(unquote);
  let pos = null;
  let repo = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('--repo=')) {
      repo = t.slice('--repo='.length);
    } else if (t.startsWith('-')) {
      if (MERGE_VALUE_FLAGS.includes(t)) {
        if (t === '-R' || t === '--repo') repo = tokens[i + 1] || repo;
        i++;
      }
    } else if (pos === null) {
      pos = t;
    }
  }
  return { pos, repo };
}

// Date ISO en millisecondes ; -Infinity si absente ou invalide.
const timeOf = (s) => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : -Infinity;
};

// Date la plus recente parmi les commits d'une PR (0 si inconnue).
function lastCommitTime(commits) {
  if (!Array.isArray(commits)) return 0;
  let max = 0;
  for (const cm of commits) {
    const t = Date.parse(cm && cm.committedDate);
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max;
}

// Le commentaire portant le marqueur (review 4 axes par defaut) le plus recent : seul il fait foi.
function latestReview(comments, marker = REVIEW_MARKER) {
  let best = null;
  let bestAt = -Infinity;
  for (const cm of comments) {
    if (!cm || typeof cm.body !== 'string' || !cm.body.includes(marker)) continue;
    const at = timeOf(cm.createdAt);
    if (best === null || at >= bestAt) {
      best = cm;
      bestAt = at;
    }
  }
  return best;
}

// Verdict final OK : derniere occurrence de « Verdict : » suivie de OK.
function verdictOk(body) {
  const verdicts = [...body.matchAll(/Verdict\s*:\s*/g)];
  const last = verdicts[verdicts.length - 1];
  return Boolean(last) && /^OK\b/.test(body.slice(last.index + last[0].length));
}

// Commentaire poste apres le dernier commit, verdict final OK (review 4 axes ou rapide).
function isFreshVerdict(cm, lastCommit) {
  return Boolean(cm) && timeOf(cm.createdAt) > lastCommit && verdictOk(cm.body);
}

// Review 4 axes complete, verdict final OK, postee apres le dernier commit.
function isFreshReview(cm, lastCommit) {
  if (!isFreshVerdict(cm, lastCommit)) return false;
  const body = cm.body;
  return /\bBUG\b/.test(body) && /\bSECURITY\b/.test(body) && /UX\/UI/.test(body) && /\bPERFORMANCE\b/.test(body);
}

// Review rapide valide : verdict final OK postee apres le dernier commit, et ligne « Tests : ... ».
const isFreshFastVerdict = (cm, lastCommit) => isFreshVerdict(cm, lastCommit) && FAST_TESTS_RE.test(cm.body);

// Entier positif (valeurs numeriques de gh pr view).
const isCount = (n) => Number.isInteger(n) && n >= 0;

// Refus de la voie rapide (fail-closed) : la review 4 axes reste requise.
const fastRefuse = (why) => `voie rapide refusée : ${why} : poste une review 4 axes (${REVIEW_MARKER}).`;

// Motifs de fastLane.sensitivePaths compiles ; sinon raison du refus (configuration invalide).
function sensitiveMatcher(fast) {
  if (!Array.isArray(fast.sensitivePaths)) return { error: 'voie rapide refusée : fastLane.sensitivePaths invalide dans hooks-config.json.' };
  try {
    const patterns = fast.sensitivePaths.map((p) => {
      if (typeof p !== 'string') throw new Error('motif non textuel');
      return new RegExp(p, 'i');
    });
    return { patterns };
  } catch (e) {
    return { error: 'voie rapide refusée : motif invalide dans fastLane.sensitivePaths.' };
  }
}

// Premier chemin sensible (ou illisible) parmi `paths` : raison du refus, sinon null.
function pathsRefusal(paths, patterns) {
  for (const p of paths) {
    if (!p) return fastRefuse('chemin de fichier illisible');
    if (patterns.some((re) => re.test(p))) return fastRefuse(`chemin sensible ${p}`);
  }
  return null;
}

// Eligibilite d'apres gh pr view (taille, fichiers listes, chemins) : null si petit diff hors chemins sensibles, sinon la raison.
function fastLaneRefusal(pr, fast) {
  const max = Number(fast.maxLines);
  if (!Number.isFinite(max)) return 'voie rapide refusée : fastLane.maxLines invalide dans hooks-config.json.';
  if (!isCount(pr.additions) || !isCount(pr.deletions)) return fastRefuse('taille du diff illisible');
  const lines = pr.additions + pr.deletions;
  if (lines > max) return fastRefuse(`${lines} lignes modifiées (> ${max})`);
  const { files, changedFiles } = pr;
  if (!Array.isArray(files) || !isCount(changedFiles) || files.length !== changedFiles) return fastRefuse('liste des fichiers incomplète');
  const sensitive = sensitiveMatcher(fast);
  if (sensitive.error) return sensitive.error;
  return pathsRefusal(files.map((f) => (f && typeof f.path === 'string' ? f.path : '')), sensitive.patterns);
}

// Hote, depot et proprietaire depuis l'URL de la PR (https://HOTE/OWNER/REPO/pull/N) ; null si illisible.
function prRepoOf(url) {
  let u;
  try { u = new URL(String(url)); } catch (e) { return null; }
  const m = /^\/([^/]+)\/([^/]+)\/pull\//.exec(u.pathname);
  if (!m || !/^[A-Za-z0-9.-]+$/.test(u.hostname) || !/^[A-Za-z0-9_.-]+$/.test(m[1]) || !/^[A-Za-z0-9_.-]+$/.test(m[2])) return null;
  return { host: u.hostname, owner: m[1], repo: m[2] };
}

// Liste complete des fichiers de la PR (gh api, renommages compris) : null si acceptable, sinon raison (fail-closed).
// Appelee seulement quand fastLaneRefusal ne trouve rien (diff deja petit).
function fastLaneFilesRefusal(c, pr, fast) {
  const repo = prRepoOf(pr.url);
  if (!repo || !Number.isInteger(pr.number) || pr.number <= 0) return fastRefuse('dépôt ou numéro de PR illisible');
  const r = sh(c, 'gh', ['api', '--hostname', repo.host, `repos/${repo.owner}/${repo.repo}/pulls/${pr.number}/files?per_page=100`], c.cwd);
  if (r.status !== 0) return fastRefuse('liste complète des fichiers indisponible (gh api)');
  const list = parseJson(r.stdout);
  if (!Array.isArray(list)) return fastRefuse('liste complète des fichiers illisible');
  if (list.length !== pr.changedFiles) return fastRefuse('liste des fichiers incomplète');
  const sensitive = sensitiveMatcher(fast);
  if (sensitive.error) return sensitive.error;
  // Nouveau chemin et, pour un renommage, ancien chemin : les deux sont testes.
  const paths = [];
  for (const f of list) {
    paths.push(f && typeof f.filename === 'string' ? f.filename : '');
    if (f && f.previous_filename !== undefined) paths.push(typeof f.previous_filename === 'string' ? f.previous_filename : '');
  }
  const refus = pathsRefusal(paths, sensitive.patterns);
  if (refus) return refus;
  // Fichier binaire : gh pr view le compte pour 0 ligne, il passerait la voie rapide. Seul un renommage pur (0 ligne) reste accepte.
  const sansLigne = list.find((f) => f && f.changes === 0 && f.status !== 'renamed');
  return sansLigne ? fastRefuse(`fichier binaire ou sans ligne comptée : ${sansLigne.filename}`) : null;
}

// --- Verifications (retournent une raison de refus, ou null) ---

// c.cwd est le depot git vise (resolu par la boucle de decide, `git -C` compris).
async function checkCommit(c) {
  const branch = currentBranch(c, c.cwd);
  if (branch === null) return null;
  const key = branchKey(branch, c.pg.issueKeyPattern);
  if (!key) return branchRefusal(branch, 'commit');
  return (await issueMissing(key, c)) ? missingIssue(key) : null;
}

async function checkPrCreate(c) {
  const branch = currentBranch(c, c.cwd);
  if (branch === null) return null;
  const key = branchKey(branch, c.pg.issueKeyPattern);
  if (!key) return branchRefusal(branch, 'gh pr create');
  const pattern = c.pg.issueKeyPattern;
  const tail = tailOf(c);
  const texts = rawValues(tail.raw, tail.masked, PR_TEXT_FLAG_RE);
  const bodyFiles = rawValues(tail.raw, tail.masked, PR_BODY_FILE_RE);
  if (bodyFiles.length && unquote(bodyFiles[bodyFiles.length - 1]) !== '-') {
    const file = resolvePath(c.cwd, bodyFiles[bodyFiles.length - 1]);
    if (file === null) return null;
    texts.push(readText(file));
  }
  // « -F - » (stdin) : le corps n'est pas inspecte, la cle doit figurer dans --title (ou --fill).
  if (!texts.some((t) => keysIn(t, pattern).includes(key))) {
    const fill = FILL_RE.test(tail.masked) && keysIn(lastSubject(c), pattern).includes(key);
    if (!fill) return `la PR doit citer ${key} : mets la clé dans --title (branche « ${branch} »).`;
  }
  return (await issueMissing(key, c)) ? missingIssue(key) : null;
}

async function checkPrMerge(c) {
  const { pos, repo } = mergeTarget(tailOf(c).raw);
  const target = [...(pos ? [pos] : []), ...(repo ? ['-R', repo] : [])];
  const view = sh(c, 'gh', ['pr', 'view', ...target, '--json', 'commits,comments,headRefName,additions,deletions,changedFiles,files,number,url'], c.cwd);
  if (view.status !== 0) return null;
  const pr = parseJson(view.stdout);
  if (!pr || typeof pr !== 'object') return null;
  const lastCommit = lastCommitTime(pr.commits);
  const comments = Array.isArray(pr.comments) ? pr.comments : [];
  if (!isFreshReview(latestReview(comments), lastCommit)) {
    // Voie rapide (ODY-130) : review rapide fraiche + petit diff hors chemins sensibles. Sinon refus.
    const fast = c.pg.fastLane;
    if (fast.enabled !== true) return REVIEW_MISSING;
    // Eligibilite d'abord (taille, chemins de la vue, renommages via gh api) : un diff non eligible est refuse avec sa raison.
    const refusal = fastLaneRefusal(pr, fast) || fastLaneFilesRefusal(c, pr, fast);
    if (refusal) return `${REVIEW_MISSING} ${refusal}`;
    if (!isFreshFastVerdict(latestReview(comments, FAST_MARKER), lastCommit)) return REVIEW_MISSING_FAST;
  }
  // Code de sortie 8 = checks en attente : le JSON reste lisible, on ignore ce code. Pas de checks : pas de JSON, passe.
  const checks = sh(c, 'gh', ['pr', 'checks', ...target, '--json', 'name,bucket'], c.cwd);
  const list = parseJson(checks.stdout);
  if (!Array.isArray(list)) return null;
  const failing = list.filter((k) => k && FAILING_BUCKETS.includes(String(k.bucket).toLowerCase())).map((k) => String(k.name));
  return failing.length ? `checks en échec : ${failing.join(', ')}.` : null;
}

async function checkDeploy(c) {
  const branch = currentBranch(c, c.cwd);
  if (branch === null) return null;
  if (branch !== 'main') {
    return `déploiement refusé depuis « ${branch || '(détachée)'} » : déploie uniquement depuis main, après merge de la PR.`;
  }
  if (sh(c, 'git', ['fetch', '-q', 'origin', 'main'], c.cwd).status !== 0) return null;
  const head = revParse(c, 'HEAD');
  const origin = revParse(c, 'origin/main');
  if (!head || !origin || head === origin) return null;
  return `HEAD (${head.slice(0, 7)}) ≠ origin/main (${origin.slice(0, 7)}) : mets main à jour (pull / merge) avant de déployer.`;
}

// --- Depot exclu : toplevel git du dossier effectif, comparé exactement (casse et séparateurs ignorés) ---

const normRepo = (p) => String(p).trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

async function isExcluded(c) {
  const list = c.pg.excludeRepos;
  if (!Array.isArray(list) || list.length === 0) return false;
  if (!c.topCache.has(c.cwd)) {
    const r = sh(c, 'git', ['rev-parse', '--show-toplevel'], c.cwd);
    c.topCache.set(c.cwd, r.status === 0 ? String(r.stdout).trim() : null);
  }
  const top = c.topCache.get(c.cwd);
  if (!top) return false;
  return list.some((p) => normRepo(p) === normRepo(top));
}

// --- Entree ---

function denyPayload(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: '[process-gate] ' + reason,
    },
  };
}

// Chaque occurrence des commandes concernees, dans l'ordre. Un deploiement compte une fois par segment,
// et --dry-run ne neutralise que le segment qui le porte.
function findHits(masked, pg) {
  const hits = [];
  const add = (check, re) => {
    for (const m of masked.matchAll(re)) hits.push({ check, index: m.index, m });
  };
  add(checkCommit, GIT_COMMIT_RE);
  add(checkPrCreate, PR_CREATE_RE);
  add(checkPrMerge, PR_MERGE_RE);
  const deploy = pg.deployPatterns.flatMap((p) => [...masked.matchAll(new RegExp(p, 'gi'))]);
  const seen = new Set();
  for (const m of deploy.sort((a, b) => a.index - b.index)) {
    const [start, end] = segmentBounds(masked, m.index);
    if (seen.has(start) || DRY_RUN_RE.test(masked.slice(start, end))) continue;
    seen.add(start);
    hits.push({ check: checkDeploy, index: m.index, m: null });
  }
  return hits.sort((a, b) => a.index - b.index);
}

// Retourne null (laisser passer) ou une raison de refus (string). Fail-open sur toute exception.
async function decide(input, config, deps) {
  try {
    const d = { ...defaultDeps(), ...(deps || {}) };
    if (d.env.PROCESS_GATE === 'off') return null;
    if (!input || typeof input !== 'object' || !SHELL_TOOLS.includes(input.tool_name)) return null;
    const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
    if (typeof ti.command !== 'string' || !ti.command) return null;
    const cfg = config || loadConfig();
    const pg = processGateConfig(cfg);
    if (pg.enabled === false) return null;

    const masked = maskQuoted(ti.command);
    const hits = findHits(masked, pg);
    if (hits.length === 0) return null;

    const deadline = d.now() + GLOBAL_TIMEOUT_MS;
    const base = {
      cmd: ti.command,
      masked,
      baseCwd: input.cwd ? String(input.cwd) : process.cwd(),
      pg,
      cfg,
      deps: d,
      deadline,
      topCache: new Map(),
    };
    const hasMerge = hits.some((h) => h.check === checkPrMerge);
    for (const hit of hits) {
      const cwd = effectiveDirAt(base, hit.index);
      if (cwd === null) continue; // chemin variable ou illisible : fail-open sur ce controle
      let c = { ...base, cwd, at: hit.index, m: hit.m };
      if (hit.check === checkCommit) {
        // Le depot controle et exclu est celui de `git -C` (ou le dossier effectif).
        const gitDir = gitDirOf(c);
        if (gitDir === null) continue;
        c = { ...c, cwd: gitDir };
      }
      // Echeance verifiee AVANT chaque controle : un controle lance a temps garde son refus.
      if (d.now() >= deadline) return null;
      if (await isExcluded(c)) continue;
      const reason = await hit.check(c);
      if (reason) return hit.check === checkDeploy && hasMerge ? reason + MERGE_DEPLOY_HINT : reason;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Sortie du hook sans I/O (appele par dispatch.js) : refus JSON, ou rien. Fail-open : toute exception -> rien.
async function hook(raw) {
  let stdout = '';
  try {
    const input = JSON.parse(raw);
    const reason = await decide(input);
    if (reason) stdout = JSON.stringify(denyPayload(reason));
  } catch (e) { /* fail-open */ }
  return { stdout, stderr: '', exitCode: 0 };
}

async function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (e) { /* fail-open */ }
  const r = await hook(raw);
  if (r.stdout) process.stdout.write(r.stdout, () => process.exit(0));
  else process.exit(0);
}

if (require.main === module) main();
module.exports = { decide, denyPayload, hook };
