---
name: livraison
description: "À charger AVANT la première modification de code ou de config : process de livraison Dotworld de bout en bout, issue Linear (recherche de doublon, critères en checklist, In Progress) → branche liée à l'issue → implémentation (parallèle si les lots sont indépendants) → tests et lint locaux → PR (Fixes <ID>, plan de test) → review indépendante sur la PR par un sous-agent du graphe → CI consultée après chaque push → commentaires de la PR et de l'issue Linear traités → In Review, sans merge. Format du commentaire de review, rôle des hooks process-gate, tool-guard, deny-list, context-budget, handoff, model-check. Ne s'applique pas aux questions, lectures ou éditions triviales d'une ou deux lignes."
---

# Livraison

Toute demande qui modifie du code ou de la config suit ce cycle, de bout en bout, sans redemander la permission entre les étapes (seuls les points d'arrêt de la fin de ce document demandent l'humain). Les règles Dotworld font foi ; les conventions du dépôt (étape 0) précisent les noms et priment sur les défauts ci-dessous.

Exceptions : une question, une lecture ou une édition triviale d'une ou deux lignes ne passe pas par ce process.

## Outils

- **Linear : connecteur MCP** (`mcp__claude_ai_Linear__*` en CLI ; dans Claude Desktop, `mcp__<uuid>__*`, chargé par `ToolSearch`, requête `linear save_issue`) : `list_issues`, `get_issue`, `list_comments`, `save_issue`, `save_comment`. La CLI `linear` seulement si aucun connecteur Linear n'est disponible.
- **GitHub : `gh`** (`gh pr create`, `gh pr view --comments`, `gh pr checks`, `gh run view`, `gh run rerun`, `gh api`).

## Process de livraison

Chaque étape est faite, et mesurée, avant la suivante.

0. **Conventions du dépôt**, lues avant tout :
   - contrat `.claude/dw.json` **sur la base distante** (`git fetch origin --prune`, puis `git show refs/remotes/origin/<base>:.claude/dw.json`, ou `dw-config.mjs read` du plugin dw) : `linear.teamKey` / `teamName`, `linear.labels`, `git.base`, `git.branchPattern`, `commands.check` / `build`, `gates.prReview` ;
   - sinon, et en complément : `CONTRIBUTING.md`, `CLAUDE.md`, `README.md`, et la documentation du domaine (`docs/`, règles métier, ADR) qui **fait foi** sur le comportement attendu ;
   - défauts Dotworld si rien n'est dit : base `main`, branche `feature/<clé>-xxxx-<slug>`, gate locale = commandes de test et de lint du dépôt.
   - Le cycle reste porté par le graphe d'agents de ce plugin (orchestrateur Sonnet, builders Haiku, opus-advisor pour le plan et la review) ; les skills dw servent de référence de process, pas d'orchestrateur. Si l'humain lance lui-même `/dw:ship`, ses garanties s'appliquent telles quelles, le statut Linear de la PR en attente de merge n'est pas touché (règle de `/dw:ship`, seulement relu et dit au compte rendu), et les étapes 9, 10 et 12 restent dues s'il ne les a pas faites.
1. **Étude et plan** : haiku-scout étudie le code concerné et renvoie une synthèse (fichiers touchés, risques, règles du dépôt qui s'appliquent), puis opus-advisor fixe le plan et l'architecture (sauf tâche simple sans décision à prendre).
2. **Issue Linear d'abord, avant toute édition de code** :
   - **Chercher d'abord une issue existante** : `list_issues` dans l'équipe du dépôt, sur les mots-clés du sujet (écran, composant, symptôme) et sur tout identifiant cité dans la demande ; lire les candidates (`get_issue`). Une issue au même périmètre se **reprend** : jamais de doublon.
   - Issue reprise : lire ses commentaires (`list_comments`), ils précisent souvent le besoin. Si elle n'a pas de critères d'acceptation en checklist, ajouter à sa description une section `## Critères d'acceptation` (sans toucher au reste ni au périmètre, et le dire en commentaire sur l'issue) s'ils se déduisent de la demande, de l'issue et de ses commentaires ; sinon, demander. Une ligne `Critères à préciser :` : stop, demander les critères.
   - Sinon, **créer** l'issue (règles de `/dw:ticket`) : équipe du dépôt ; titre court qui décrit le livrable ; description = contexte en 1 à 3 phrases (faits, références, fichiers), `## À faire`, `## Critères d'acceptation` **en checklist** `- [ ] …`, testables et dérivés de la demande (jamais inventés), `## Hors périmètre` si quelque chose est exclu. Priorité seulement si la demande en fixe une ; label seulement parmi ceux du contrat (`linear.labels`), sans contrat aucun, **jamais de label créé**.
   - Passer l'issue à **`In Progress`** (`save_issue`) dès que la branche existe (étape 3), **avant la première édition de code**.
3. **Branche liée à l'issue**, depuis la base distante fraîche (`git fetch origin --prune`, puis `git switch -c <branche> refs/remotes/origin/<base>`, ou un worktree par lot parallèle), jamais sur `main`. Nom : `git.branchPattern` du contrat ; sinon la convention de la doc du dépôt (ex. `<ID>-<slug>`) ; sinon `feature/<clé>-xxxx-<slug>`. L'identifiant de l'issue est toujours dans le nom : Linear lie la branche, et le hook process-gate refuse un commit sans lui.
4. **Implémentation**, selon la nature du travail :
   - logique, backend, tests, scripts, sans design ni intégration : **haiku-builder** ;
   - petite intégration UI ou design limité : **sonnet-builder** (prompt `DIRECT:` + justification « intégration UI ») ;
   - gros bloc UI, landing page, refonte d'écran : **opus-builder** (Opus medium, prompt `OPUS:` + justification).
   - **Tout changement UI/UX fait par Sonnet ou Opus passe d'abord par `/design`** : la maquette est produite en design Claude (Artifact de type Design), son lien claude.ai est ajouté à l'issue Linear (pour que l'utilisateur puisse la modifier), puis l'implémentation suit ce design. Si l'utilisateur modifie le design, réaligner le code dessus.
   - **Parallélisation** : plusieurs issues indépendantes → plusieurs worktrees et agents lancés en parallèle, dans le même message (un worktree par issue ou lot qui modifie des fichiers). Branche empilée sur une autre branche quand il y a dépendance. On ne sérialise que si deux lots modifient les mêmes passages d'un fichier ou si un lot dépend du résultat d'un autre ; un conflit sur des clés différentes d'un JSON n'est pas une raison de sérialiser. Objectif : livrer le plus vite et au plus bas coût en tokens (agents Haiku, briefs courts).
   - Règles de code transmises dans chaque brief : partir des critères d'acceptation ; sur un bug, d'abord un test de régression qui échoue sur la base, puis le correctif (le constat rouge va au plan de test) ; toute nouvelle logique couverte par un test qui échouerait si elle était cassée ; ne jamais supprimer, désactiver ni affaiblir un test existant ; respecter les chemins gelés et les règles du dépôt ; la doc suit dans la même PR.
   - **Bug ou défaut hors périmètre** : ne pas le corriger dans cette PR. Ouvrir une **issue séparée** (même règles qu'à l'étape 2, recherche de doublon comprise), liée à l'issue courante (`relatedTo`), et la citer dans la PR et dans le compte rendu. Exception Dotworld : un défaut du sous-système qu'on étend, qui annule la valeur livrée, se corrige dans la PR et s'y dit ; une faille de sécurité pré-existante va toujours dans une issue dédiée.
5. **Commits réguliers en local** (un commit par étape cohérente) : Conventional Commits en français, identifiant de l'issue dans le titre, corps Avant / Après, trailer `Co-Authored-By` que la session prescrit. Jamais `--no-verify`.
6. **Gate locale avant la PR : tests ET lint**, plus le build ou le check du contrat (`commands.check`, sinon les commandes de la doc du dépôt, ex. `npm test` et `npm run lint`). Code de sortie lu, sortie lue. Rouge : corriger, pas de PR. Commande absente : le dire dans la PR.
7. **Push et pull request** liée à l'issue, une fois la gate verte :
   - `git push -u origin <branche>`, puis `gh pr create --base <base> --title "<type>(domaine): description (<CLÉ>-XXXX)" --body-file <fichier>` ;
   - corps : **`Fixes <CLÉ>-XXXX` en première ligne** (ou le mot-clé de fermeture que la doc du dépôt impose, `Closes` ou `Resolves`), puis `## Résumé`, `## Diagnostic` (bug), `## Fix`, `## Plan de test` (table vérification → résultat : commandes lancées et leur résultat, test de régression rouge puis vert, ce qui n'a pas pu être vérifié et pourquoi), issues hors périmètre ouvertes, et la ligne d'attribution que la session prescrit ;
   - commentaire sur l'issue Linear : lien de la PR et fichiers modifiés ;
   - la PR n'est pas encore déclarée prête : la review (étape 8), la CI (étape 9) et les retours (étape 10) suivent.
8. **Review indépendante sur la PR**, avant de la déclarer prête : toujours faite par un **sous-agent du graphe**, jamais par l'agent qui a écrit le code, même pour un petit fix.
   - **opus-advisor** relit la PR (`gh pr diff <pr>`, l'issue et ses critères, la doc qui fait foi) sur 4 axes, chacun avec un verdict : **BUG** (correction, cas limites, régressions, critères d'acceptation), **SECURITY** (secrets, auth, injections, données exposées), **UX/UI** (cohérence visuelle, accessibilité, états vides, chargement et erreur), **PERFORMANCE / COÛT** (requêtes, rendu, taille des bundles, coûts infra et API). Petit diff : voie rapide (sonnet-reviewer) plus bas.
   - L'orchestrateur poste la review sur la PR (`gh pr comment`), au format défini dans `agents/opus-advisor.md` : marqueur `<!-- review-4-axes -->`, sections BUG / SECURITY / UX/UI / PERFORMANCE / COÛT et `Verdict : OK` ou `Verdict : À CORRIGER`.
   - À corriger : les faire corriger (même niveau d'agent que l'implémentation), un commit par correctif, gate locale, push, récapitulatif « point → commit » sur la PR, puis nouvelle review des axes concernés, postée elle aussi, jusqu'à `Verdict : OK` **posté après le dernier commit**.
   - Dépôt Dotworld à contrat avec `gates.prReview` : la CI attend en plus la review GitHub `Verdict : GREEN` de `/dw:review`. Lancer `/dw:review <URL de la PR>` (cycle complet, jamais de GREEN postée hors de ce cycle) ; son relecteur `dw:fr-reviewer` n'est pas un agent du graphe et `routing-guard` le refuse : opus-advisor tient ce rôle, avec le même brief (diff écrit dans le scratchpad, doc de contexte, risque visé).
   - Verdict de review commenté sur l'issue Linear.
9. **CI consultée après chaque push**, le dernier compris : `gh pr checks <pr> --watch` (ou relancé jusqu'à ce qu'aucun check ne soit en attente).
   - Rouge : lire le log (`gh run view <id> --log-failed`).
   - **Échec d'infrastructure** (runner perdu, timeout réseau, service tiers indisponible, job annulé sans erreur du code) : relancer le job (`gh run rerun <id> --failed`) **sans modifier le code**, puis reconsulter la CI.
   - Échec réel : corriger, gate locale, commit, push, re-review si le correctif touche du fond, puis reconsulter.
   - **Branche à jour avec la base** : si la base a avancé (`git fetch origin` puis `git merge-base --is-ancestor refs/remotes/origin/<base> HEAD` en échec) ou en conflit, l'intégrer par **merge** (`git merge refs/remotes/origin/<base> --no-edit`, pas de rebase d'une branche poussée), gate locale, push, CI.
10. **Retours après l'ouverture de la PR**, avant de la déclarer prête, puis de nouveau après chaque push de correctifs :
    - lire les commentaires de la PR (`gh pr view <pr> --comments`, plus les commentaires de ligne et les reviews : `gh api repos/<repo>/pulls/<pr>/comments` et `…/reviews`) ;
    - relire **l'issue Linear et ses commentaires** (`get_issue`, `list_comments`) : le besoin a pu changer depuis l'ouverture ; un besoin modifié s'intègre (commit, critères et plan de test mis à jour), un besoin contradictoire se signale ;
    - **commentaire bloquant** (bug, demande conforme à la spec) : commit de correction **et** réponse sur la PR qui cite le commit ;
    - **suggestion contraire à la spec, à un ADR, à la doc du domaine ou aux critères d'acceptation** : ne pas l'appliquer ; répondre sur la PR avec la justification et la référence (fichier, section) ;
    - question : y répondre ; aucun commentaire ignoré sans réponse ;
    - réponses : `gh pr comment <pr> --body-file <fichier>`, ou en réponse au fil (`gh api repos/<repo>/pulls/<pr>/comments/<id>/replies -f body=…`) ;
    - après chaque correctif poussé : étape 9 (CI), puis relire à nouveau, jusqu'à ce qu'il ne reste aucun retour ouvert.
11. **PR prête, sans merge** : review OK postée après le dernier commit, CI verte consultée après le dernier push, branche qui contient la base à jour, retours de la PR et de l'issue traités. Alors :
    - commentaire sur l'issue Linear : « PR #<num> prête (review OK, retours traités, CI verte), en attente de merge » ;
    - statut : relire l'issue ; si elle n'est pas déjà `In Review` (l'automatisation GitHub de Linear l'y passe souvent à l'ouverture de la PR), la passer à **`In Review`** ; sous `/dw:ship`, ne pas y toucher et le dire (étape 0). Jamais `Done` sans merge effectif.
    - **Jamais de merge par l'agent** : un humain merge. Exception unique, demandée explicitement par l'humain dans la conversation : `/dw:ship --auto-merge` sur un dépôt dont le contrat l'autorise. Le hook process-gate refuse `gh pr merge` tant que `processGate.agentMerge` n'est pas `true`. Un déploiement suit le merge humain, depuis `main` à jour, et seulement sur demande.
12. **Compte rendu final honnête** : PR (lien, état), issue (identifiant, statut), preuves (vérification → résultat, mesurées et non supposées), findings de review et commentaires traités ou contestés (avec la raison), issues hors périmètre ouvertes, ce qui n'a pas été fait ou vérifié et pourquoi, ce qui reste à l'humain (merge). Ne jamais annoncer vert, prêt ou testé ce qui n'a pas été mesuré.

**Points d'arrêt (demander à l'humain)** : critères d'acceptation non déductibles ou ligne `Critères à préciser :` ; identifiant d'une autre équipe que celle du dépôt ; issue, branche ou PR déjà en cours ailleurs ; prérequis (issue bloquante, PR citée) non mergé ; gate locale non déterministe ou tests cassés hors périmètre ; besoin contradictoire entre l'issue et la doc qui fait foi.

## Classement Linear

Règles Dotworld de `/dw:ticket` :

- Équipe : celle du contrat (`linear.teamName`), sinon celle que nomme la doc du dépôt ; aucune des deux : demander. Un identifiant d'une autre équipe : stop, demander.
- **Doublons d'abord** : une issue au même périmètre se reprend ou se complète, on n'en crée pas une seconde. Une issue proche mais distincte se lie par `relatedTo`.
- Projet : celui que nomme la demande ou le contrat (`linear.projectAliases`) ; à défaut, aucun. Ne créer ni projet ni label sans demande de l'humain.
- Labels : seulement ceux de `linear.labels`, celui qui correspond à la nature du sujet ; ambigu ou sans `linear.labels` : aucun.
- Priorité : celle que fixe la demande, sinon aucune.
- Dépendances : relation « bloque / bloqué par / lié à » entre issues.
- Pièges du MCP Linear : marquer un doublon par `duplicateOf` seul (sans `state`) ; Linear ferme une issue au merge d'une PR dont la **branche** porte son identifiant, pas seulement par `Fixes <ID>` ; aucun outil ne supprime une issue.

## Voie rapide (petits diffs)

Pour un petit diff, la review de l'étape 8 peut être faite par **sonnet-reviewer** au lieu d'opus-advisor, si :
- le diff compte **30 lignes au plus** (ajoutées + supprimées) et ne touche **aucun chemin sensible** (`processGate.fastLane.sensitivePaths` de `hooks-config.json` : hooks, settings, `.env`, secrets, auth, deploy, wrangler, workflows, agents, `CLAUDE.md`, skills de livraison, `package.json`, `.npmrc`) ;
- les tests, le build ou le lint passent (sorties citées dans le commentaire) ;
- le commentaire de PR contient `<!-- review-rapide -->`, une ligne `Tests : <commandes et résultat>` (sans elle, le hook refuse) et se termine par `Verdict : OK` (format dans `agents/sonnet-reviewer.md`).

Le hook process-gate mesure seul la taille, les chemins (renommages compris) et la ligne `Tests :`. L'issue Linear, la PR, la CI et le traitement des retours restent obligatoires.

## Briefs des sous-agents

- **Brief autonome** : chaque sous-agent reçoit objectif, fichiers concernés, contraintes (règles de code de l'étape 4, chemins gelés, doc qui fait foi) et critère de réussite (ex. « les tests X passent »). Inutile de transmettre toute la conversation.
- **Règle d'or Haiku** : chaque brief Haiku fixe un objectif final clair et vérifiable (« le endpoint X répond et ses tests passent »), pas forcément atomique. Haiku gère mal les tâches longues : si l'objectif ne tient pas en ~10 itérations, découper.
- **Boucle courte** : Haiku ne dépasse pas 10 itérations (essai → vérification → correction) ; au-delà il s'arrête et fait son reporting (ou `ESCALATE:`).
- **Filtre de contexte** : c'est haiku-scout qui lit les gros logs, la doc ou les longs fichiers et renvoie une synthèse d'environ 10 lignes à l'orchestrateur, jamais l'inverse. L'orchestrateur ne lit pas lui-même de pavés.
- **ESCALATE** : si un sous-agent répond `ESCALATE:`, passer au niveau supérieur avec ce qu'il a appris et tenté.
- **Escalade** : haiku-builder (ESCALATE ou 2 échecs au vérificateur) → sonnet-builder (prompt `ESCALADE:` avec ce qui a été appris) → en cas d'échec, relance unique en effort high → si ça échoue encore, l'orchestrateur reprend la main avec opus-advisor.
- **Agents spécialisés** : `fr-reviewer`, `linear-planner`, `Explore`, `Plan` et `claude-code-guide` restent utilisables ; leur `model:` définit leur niveau. Les agents d'autres plugins (dont `dw:fr-reviewer`, `dw:feature-researcher` et le `general-purpose` de `/dw:ship-project` et `/dw:plan-project`) sont refusés par `routing-guard` : leur rôle passe aux agents du graphe.
- **Rôles** : l'orchestrateur garde les questions à l'utilisateur, Linear, la PR, la CI, les réponses aux commentaires et la synthèse. Conception, choix d'architecture, arbitrages ambigus et review vont à opus-advisor (brief autonome : demande, contexte utile, synthèse du scout). L'exécution va aux sous-agents, sans que l'utilisateur ait à le demander. Un sous-agent qui repère un bug hors périmètre le signale dans son rapport ; c'est l'orchestrateur qui ouvre l'issue.

## Hooks d'économie et de process

Seuils réglables dans `hooks/hooks-config.json` du plugin (surcharge locale : `${CLAUDE_PLUGIN_DATA}/hooks-config.local.json`, fusion de premier niveau : une clé comme `processGate` s'y recopie en entier). Un refus d'un hook n'est pas une erreur : lis sa raison et applique l'alternative.

- **tool-guard** (avant chaque outil) : refuse un appel répété 3 fois (change d'approche ou `ESCALATE:`), coupe un sous-agent qui dépasse son budget d'appels (rends ton rapport), refuse la lecture entière d'un gros fichier, les recherches trop larges et les commandes à sortie énorme (filtre ou délègue à haiku-tools). Relancer exactement le même appel force le passage (read/recherche/sortie seulement).
- **context-budget** (à chaque message) : seuils en tokens absolus de contexte (fenêtre réelle 1M) : à 200k tokens, délègue ; à 300k, écris la passation dans `~/.claude/handoffs/<projet>.md` ; à 400k, le message est bloqué une fois (il n'est pas envoyé) : écris la passation puis `/clear`. Ces seuils sont un plafond de coût volontaire. Aux seuils de 300k et de blocage, une ligne `/compact garde : …` prête à coller est proposée : elle résume la passation (tâche, issue, branche, reste à faire).
- **deny-list** (tool-guard, avant chaque outil) : refuse les commandes destructrices listées dans `toolGuard.denyCommands` de `hooks-config.json`.
- **handoff** (au démarrage, après `/clear` ou une compaction) : recharge la passation du projet. Si la demande actuelle prolonge cette tâche, reprends à « Reste à faire », sinon ignore-la ; mets à jour ou supprime le fichier quand la tâche est finie.
- **pre-compact** (PreCompact, manuel ou auto) : écrit ou rafraîchit la passation du projet avant un compactage (passation minimale si elle n'existe pas ; sinon seul le bloc `<!-- precompact -->` en fin de fichier est mis à jour). Ne bloque jamais.
- **model-router** (UserPromptSubmit) : le rappel `[Routage]` n'apparaît qu'une fois par session ; il revient après un compactage ou un `/clear`.
- **process-gate** (PreToolUse sur `Bash|PowerShell`) : refuse `git commit` sur `main` ou sur une branche sans identifiant d'issue Linear (au début du nom ou d'un segment ; `linear.teamKey` du contrat `.claude/dw.json` s'il existe, sinon `processGate.issueKeyPattern`), `gh pr create` sans cet identifiant dans le titre ou le corps, **`gh pr merge` et `gh api …/pulls/<n>/merge` tant que `processGate.agentMerge` n'est pas `true`** (merge réservé à l'humain) puis, si l'agent y est autorisé, sans le commentaire de review `<!-- review-4-axes -->` (ou `<!-- review-rapide -->` avec sa ligne `Tests :` en voie rapide) plus récent que le dernier commit, ou avec des checks en échec ; refuse aussi tout déploiement hors de `main` à jour. Avec `LINEAR_API_KEY`, il vérifie que l'issue existe.
- **model-check** (SessionStart) : avertit si la session ne tourne pas sur `orchestratorModel` (clé de `hooks-config.json`, défaut `sonnet`).
- Interrupteurs d'urgence : `TOOL_GUARD=off`, `CONTEXT_BUDGET=off`, `HANDOFF=off`, `PROCESS_GATE=off`, `MODEL_CHECK=off`, `DENY_LIST=off`.
