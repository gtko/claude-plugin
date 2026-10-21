---
name: livraison
description: "À utiliser avant toute modification de code ou de config : process de livraison issue Linear → branche/worktree → implémentation (parallèle si les lots sont indépendants) → commits → review locale 4 axes → PR → merge/déploiement, format du commentaire de review, rôle des hooks process-gate, tool-guard, deny-list, context-budget, handoff, model-check. Ne s'applique pas aux questions, lectures ou éditions triviales d'une ou deux lignes."
---

# Livraison

Toute demande qui modifie du code ou de la config suit ce cycle, de bout en bout, sans redemander la permission entre les étapes.

## Process de livraison

1. **Étude et plan** : haiku-scout étudie le code concerné et renvoie une synthèse (fichiers touchés, risques), puis opus-advisor fixe le plan et l'architecture (sauf tâche simple sans décision à prendre).
2. **Linear** : créer une issue Linear avec le contexte, l'approche et la liste des fichiers touchés, puis la classer (voir « Classement Linear »).
3. **Branche** : travailler sur une branche dédiée (worktree) liée à l'issue, jamais directement sur `main`.
4. **Implémentation**, selon la nature du travail :
   - logique, backend, tests, scripts, sans design ni intégration : **haiku-builder** ;
   - petite intégration UI ou design limité : **sonnet-builder** (prompt `DIRECT:` + justification « intégration UI ») ;
   - gros bloc UI, landing page, refonte d'écran : **opus-builder** (Opus medium, prompt `OPUS:` + justification).
   - **Tout changement UI/UX fait par Sonnet ou Opus passe d'abord par `/design`** : la maquette est produite en design Claude (Artifact de type Design), son lien claude.ai est ajouté à l'issue Linear (pour que l'utilisateur puisse la modifier), puis l'implémentation suit ce design. Si l'utilisateur modifie le design, réaligner le code dessus.
   - **Parallélisation** : plusieurs issues indépendantes → plusieurs worktrees et agents lancés en parallèle, dans le même message (un worktree par issue ou lot qui modifie des fichiers). Branche empilée sur une autre branche quand il y a dépendance. On ne sérialise que si deux lots modifient les mêmes passages d'un fichier ou si un lot dépend du résultat d'un autre ; un conflit sur des clés différentes d'un JSON n'est pas une raison de sérialiser. Objectif : livrer le plus vite et au plus bas coût en tokens (agents Haiku, briefs courts).
5. **Commits réguliers en local** pendant l'implémentation (un commit par étape cohérente). Pas de push à ce stade.
6. **Review locale par opus-advisor, avant tout push** : sur le diff local (`git diff main...HEAD`), plus rapide qu'une review de PR. 4 axes, chacun avec un verdict :
   - **BUG** : correction, cas limites, régressions ;
   - **SECURITY** : secrets, auth, injections, données exposées ;
   - **UX/UI** : cohérence visuelle, accessibilité, états vides, chargement et erreur ;
   - **PERFORMANCE / COÛT** : requêtes, rendu, taille des bundles, coûts infra et API.
7. **Corrections** : si la review demande des changements, les faire corriger (même niveau d'agent que l'implémentation), commit, puis nouvelle review du diff sur les axes concernés, jusqu'à OK.
8. **Push et pull request** liée à l'issue, seulement une fois la review OK. Le résultat de la review est posté en commentaire de la PR (`gh pr comment`, pas de nouvelle review complète), au format défini dans `~/.claude/agents/opus-advisor.md` : marqueur `<!-- review-4-axes -->`, sections BUG / SECURITY / UX/UI / PERFORMANCE / COÛT et `Verdict : OK`. Le hook process-gate refuse `gh pr merge` sans ce commentaire (ou, en voie rapide, sans `<!-- review-rapide -->` et sa ligne `Tests :`), plus récent que le dernier commit, ni avec des checks en échec ; il refuse aussi `git commit` sur `main` ou sur une branche sans clé d'issue (`ody-XXX`), et tout déploiement hors de `main` à jour.
9. **Mise à jour Linear** : avancement, fichiers modifiés, verdict de review, lien vers la PR.
10. **Merge et déploiement** : review OK, alors merge dans `main` et déploiement en production (en suivant le skill ou la procédure de déploiement du projet), puis passer l'issue Linear à « Done » avec un résumé.

Exceptions : une question, une lecture ou une édition triviale d'une ou deux lignes ne passe pas par ce process.

## Classement Linear (règle importante)

- **Toute issue créée va dans un projet.** Chercher d'abord un projet ouvert (Planned / In Progress / Backlog) dont le périmètre couvre vraiment la tâche (lister les projets, lire leur résumé).
- Avant de créer un projet dédié, préférer un projet ouvert du même produit dont le périmètre peut raisonnablement s'étendre (périmètre nommé, pas fourre-tout).
- **Sinon, créer un projet dédié**, ciblé sur un objectif (produit, version ou chantier), avec : résumé et périmètre (dont hors périmètre), date de début et date de fin (`startDate`, `targetDate`), priorité, label d'impact `Impact: Low` / `Impact: Medium` / `Impact: High` (groupe de labels projet `Impact`, choix unique), statut et lead.
- **Pas de projet fourre-tout** (« Divers », « Tech », « Maintenance »…) : une tâche qui ne colle à aucun projet en justifie un nouveau, même petit.
- **Chaque issue a une priorité** (Urgent / High / Medium / Low), jamais « No priority ».
- **Chaque issue a exactement un label de type** :
  - `Bug` : défaut d'un code déjà mergé dans `main` (vérifier avec `git log main -- <fichier>` ou `git blame`) ;
  - `Feature` : nouvelle fonctionnalité absente de `main` ;
  - `Improvement` : amélioration d'un code déjà existant ;
  - `Recettage` : retour de review sur un code pas encore mergé dans `main` ;
  - `Productivity` : changement non impactant (clé, variable d'environnement, config, outillage) ; prime sur `Improvement` si le changement n'a aucun effet visible pour l'utilisateur.
- **Labels absents** : si un label (type ou `Impact`) n'existe pas, le créer une fois avec ce nom exact ; si l'outil ne permet pas de poser un label de projet, écrire `Impact: X` dans la description du projet.
- **Dépendances** si besoin : entre issues par relation « bloque / bloqué par / lié à » ; entre projets, relation dans Linear quand l'outil le permet, sinon une section « Dépend de : <projet> » dans la description du projet.
- Mettre à jour les dates du projet quand le plan glisse, et le passer à « Completed » quand ses issues sont livrées.
## Voie rapide (petits diffs)

Pour un petit diff, la review de l'étape 6 peut être faite par **sonnet-reviewer** au lieu d'opus-advisor, si :
- le diff compte **30 lignes au plus** (ajoutées + supprimées) et ne touche **aucun chemin sensible** (`processGate.fastLane.sensitivePaths` de `hooks-config.json` : hooks, settings, `.env`, secrets, auth, deploy, wrangler, workflows, agents, `CLAUDE.md`, skills de livraison, `package.json`, `.npmrc`) ;
- les tests, le build ou le lint passent (sorties citées dans le commentaire) ;
- le commentaire de PR contient `<!-- review-rapide -->`, une ligne `Tests : <commandes et résultat>` (sans elle, le hook refuse) et se termine par `Verdict : OK` (format dans `claude/agents/sonnet-reviewer.md`).

Le hook process-gate mesure seul la taille, les chemins (renommages compris) et la ligne `Tests :`, et refuse avec la raison hors critères. L'issue Linear et la PR restent obligatoires.

## Briefs des sous-agents

- **Brief autonome** : chaque sous-agent reçoit objectif, fichiers concernés, contraintes et critère de réussite (ex. « les tests X passent »). Inutile de transmettre toute la conversation.
- **Règle d'or Haiku** : chaque brief Haiku fixe un objectif final clair et vérifiable (« le endpoint X répond et ses tests passent »), pas forcément atomique. Haiku gère mal les tâches longues : si l'objectif ne tient pas en ~10 itérations, découper.
- **Boucle courte** : Haiku ne dépasse pas 10 itérations (essai → vérification → correction) ; au-delà il s'arrête et fait son reporting (ou `ESCALATE:`).
- **Filtre de contexte** : c'est haiku-scout qui lit les gros logs, la doc ou les longs fichiers et renvoie une synthèse d'environ 10 lignes à l'orchestrateur, jamais l'inverse. L'orchestrateur ne lit pas lui-même de pavés.
- **ESCALATE** : si un sous-agent répond `ESCALATE:`, passer au niveau supérieur avec ce qu'il a appris et tenté.
- **Escalade** : haiku-builder (ESCALATE ou 2 échecs au vérificateur) → sonnet-builder (prompt `ESCALADE:` avec ce qui a été appris) → en cas d'échec, relance unique en effort high → si ça échoue encore, l'orchestrateur reprend la main avec opus-advisor.
- **Agents spécialisés** : `implementer`, `fr-reviewer`, `linear-planner`, `Explore`, `Plan` et `claude-code-guide` restent utilisables ; leur `model:` définit leur niveau.
- **Rôles** : l'orchestrateur garde les questions à l'utilisateur, le suivi et la synthèse. Conception, choix d'architecture, arbitrages ambigus et review finale vont à opus-advisor (brief autonome : demande, contexte utile, synthèse du scout). L'exécution va aux sous-agents, sans que l'utilisateur ait à le demander.

## Hooks d'économie (contexte, boucles, lectures)

Seuils réglables dans `~/.claude/hooks/hooks-config.json`. Un refus d'un hook n'est pas une erreur : lis sa raison et applique l'alternative.

- **tool-guard** (avant chaque outil) : refuse un appel répété 3 fois (change d'approche ou `ESCALATE:`), coupe un sous-agent qui dépasse son budget d'appels (rends ton rapport), refuse la lecture entière d'un gros fichier, les recherches trop larges et les commandes à sortie énorme (filtre ou délègue à haiku-tools). Relancer exactement le même appel force le passage (read/recherche/sortie seulement).
- **context-budget** (à chaque message) : seuils en tokens absolus de contexte (fenêtre réelle 1M) : à 200k tokens, délègue ; à 300k, écris la passation dans `~/.claude/handoffs/<projet>.md` ; à 400k, le message est bloqué une fois (il n'est pas envoyé) : écris la passation puis `/clear`. Ces seuils sont un plafond de coût volontaire. Aux seuils de 300k et de blocage, une ligne `/compact garde : …` prête à coller est proposée : elle résume la passation (tâche, issue, branche, reste à faire).
- **deny-list** (tool-guard, avant chaque outil) : refuse les commandes destructrices listées dans `toolGuard.denyCommands` de `hooks-config.json`.
- **handoff** (au démarrage, après `/clear` ou une compaction) : recharge la passation du projet. Si la demande actuelle prolonge cette tâche, reprends à « Reste à faire », sinon ignore-la ; mets à jour ou supprime le fichier quand la tâche est finie.
- **pre-compact** (PreCompact, manuel ou auto) : écrit ou rafraîchit la passation du projet avant un compactage (passation minimale si elle n'existe pas ; sinon seul le bloc `<!-- precompact -->` en fin de fichier est mis à jour). Ne bloque jamais.
- **model-router** (UserPromptSubmit) : le rappel `[Routage]` n'apparaît qu'une fois par session ; il revient après un compactage ou un `/clear`.
- **process-gate** (PreToolUse sur `Bash|PowerShell`) : refuse `gh pr merge` sans le commentaire de review `<!-- review-4-axes -->` (ou `<!-- review-rapide -->` avec sa ligne `Tests :` en voie rapide) plus récent que le dernier commit, ou avec des checks en échec, refuse `git commit` sur `main` ou sur une branche sans clé `ody-XXX`, et tout déploiement hors de `main` à jour. Détail à l'étape 8.
- **model-check** (SessionStart) : avertit si la session ne tourne pas sur `orchestratorModel` (clé de `hooks-config.json`, défaut `sonnet`).
- Interrupteurs d'urgence : `TOOL_GUARD=off`, `CONTEXT_BUDGET=off`, `HANDOFF=off`, `PROCESS_GATE=off`, `MODEL_CHECK=off`, `DENY_LIST=off`.
