---
name: livraison
description: "À charger AVANT la première modification de code ou de config : process de livraison (issue Linear sans doublon, branche, tests et lint, PR, review sur la PR, CI, retours PR et Linear, In Review, sans merge) et rôle des hooks. Pas pour une question, une lecture ou une édition d'une ou deux lignes."
---

# Livraison

Toute modification de code ou de config suit ce cycle de bout en bout, sans redemander entre les étapes (sauf aux points d'arrêt). Hors process : question, lecture, édition triviale d'une ou deux lignes. Chaque étape est mesurée avant la suivante.

**Outils** : Linear par le connecteur MCP (`mcp__claude_ai_Linear__*` ; dans Claude Desktop `mcp__<uuid>__*`, via `ToolSearch` « linear save_issue »), la CLI `linear` seulement sans connecteur ; GitHub par `gh`.

## Process

0. **Conventions** : `CONTRIBUTING.md`, `CLAUDE.md`, `README.md` (équipe Linear, base, nom de branche, commandes de test et de lint, format de PR) ; `docs/` et ADR **font foi** sur le comportement. Défauts : base `main`, branche `feature/<clé>-xxxx-<slug>`.
1. **Étude et plan** : haiku-scout synthétise (fichiers, risques, règles du dépôt) ; opus-advisor fixe le plan s'il y a une décision à prendre.
2. **Issue d'abord, avant toute édition** :
   - **chercher un doublon** (`list_issues` sur les mots-clés et les identifiants cités, `get_issue` + `list_comments`) : issue au même périmètre = la reprendre ; sans critères, y ajouter `## Critères d'acceptation` s'ils se déduisent (sans toucher au reste, et le dire en commentaire), sinon demander ;
   - sinon créer : contexte 1 à 3 phrases, `## À faire`, `## Critères d'acceptation` en `- [ ] …` (jamais inventés), `## Hors périmètre`.
3. **Branche** depuis `refs/remotes/origin/<base>` fraîche, jamais `main`, nom avec l'identifiant de l'issue (convention du dépôt, sinon défaut). Issue en **`In Progress`** avant la première édition.
4. **Implémentation** selon le graphe : haiku-builder par défaut ; sonnet-builder (`DIRECT:` + « intégration UI ») ; opus-builder (`OPUS:`, gros bloc UI). Tout changement UI/UX par Sonnet ou Opus passe d'abord par `/design` (lien claude.ai de la maquette ajouté à l'issue, code réaligné si l'utilisateur la modifie). Lots indépendants en parallèle, un worktree chacun ; on ne sérialise que si deux lots touchent les mêmes passages ou dépendent l'un de l'autre.
   - Brief : critères d'acceptation ; sur un bug, test de régression rouge d'abord ; nouvelle logique couverte par un test qui échouerait si elle était cassée ; aucun test supprimé ni affaibli ; chemins gelés respectés ; doc mise à jour dans la PR.
   - **Hors périmètre** : pas de correction ici ; issue séparée (dédoublonnée, `relatedTo`), citée dans la PR et le compte rendu. Seule exception : un défaut du sous-système étendu qui annule la valeur livrée. Faille de sécurité pré-existante : toujours une issue dédiée.
5. **Commits** : `type(scope): description (<CLÉ>-XXXX)` en français, corps Avant / Après, trailer `Co-Authored-By` de la session ; jamais `--no-verify`.
6. **Gate locale : tests ET lint** (et build s'il existe), code de sortie lu. Rouge : pas de PR.
7. **PR** : `git push -u` (attendre sa fin), puis `gh pr create --body-file` ; titre `<type>(domaine): description (<CLÉ>-XXXX)` ; corps : `Fixes <CLÉ>-XXXX` en première ligne (ou `Closes` / `Resolves` si la doc l'impose), `## Résumé`, `## Diagnostic`, `## Fix`, `## Plan de test` (vérification → résultat, test rouge puis vert, ce qui n'est pas vérifié), issues hors périmètre, attribution de la session. Lien commenté sur l'issue. Pas encore « prête ».
8. **Review indépendante sur la PR**, par un sous-agent, jamais par l'auteur : l'agent de relecture du dépôt s'il en fournit un (`.claude/agents`, appelé avec `model: "sonnet"`), sinon opus-advisor (`gh pr diff`, critères, doc qui fait foi), 4 axes BUG / SECURITY / UX/UI / PERFORMANCE / COÛT, postée par l'orchestrateur (`gh pr comment`) au format de `agents/opus-advisor.md` (`<!-- review-4-axes -->`, `Verdict : OK` ou `À CORRIGER`). À corriger : un commit par point, gate, push, récap « point → commit », re-review jusqu'à `Verdict : OK` **après le dernier commit**. Verdict commenté sur l'issue.
9. **CI après chaque push, en séquence** : le push terminé, puis `gh pr checks <pr> --watch` dans **un appel d'outil séparé**, jamais dans la même commande (`git push && gh pr checks`) ni le même lot parallèle qu'un push, un commit ou un `gh pr create`, jusqu'à un état final, sur le head de la PR (`git rev-parse HEAD` = `gh pr view --json headRefOid`). Chaque nouveau push (correctif, réponse à un commentaire, merge de la base) relance cette vérification. Échec d'infra (runner perdu, timeout réseau, service tiers) : `gh run rerun <id> --failed`, **sans toucher au code**. Échec réel : `gh run view --log-failed`, corriger. Base avancée ou conflit : `git merge refs/remotes/origin/<base> --no-edit` (pas de rebase d'une branche poussée), gate, push.
10. **Retours**, après l'ouverture puis après chaque push : commentaires de la PR (`gh pr view --comments`, `gh api …/pulls/<pr>/comments` et `…/reviews`) **et** de l'issue Linear (le besoin a pu changer : l'intégrer).
    - bloquant : commit **et** réponse sur la PR citant le commit ;
    - suggestion contraire à la spec, à un ADR ou aux critères : ne pas l'appliquer, répondre avec la justification et la référence ;
    - aucun commentaire sans réponse ; boucle jusqu'à ce que rien ne reste ouvert.
11. **Prête, sans merge** (review OK après le dernier commit, CI verte constatée sur le dernier commit poussé, base intégrée, retours traités) : commentaire Linear « PR #<num> prête, en attente de merge » ; issue `In Review` si elle n'y est pas déjà ; jamais `Done` sans merge. **Un humain merge** ; déploiement seulement après, depuis `main` à jour, sur demande.
12. **Compte rendu honnête**, rédigé seulement après la CI verte du dernier push : PR et issue (statut), preuves mesurées, retours traités ou contestés, issues hors périmètre, ce qui n'est pas fait ou pas vérifié, ce qui reste à l'humain. Rien d'annoncé vert sans mesure.

**Points d'arrêt** : critères non déductibles ou ligne `Critères à préciser :` ; issue d'une autre équipe ; issue, branche ou PR déjà en cours ailleurs ; prérequis non mergé ; gate non déterministe ou tests cassés hors périmètre ; besoin contradictoire avec la doc qui fait foi.

## Linear

- Équipe nommée par la doc du dépôt, sinon demander. Labels existants seulement, jamais créés ; priorité et projet seulement s'ils sont demandés ; dépendances par relations entre issues.
- Pièges du MCP : doublon par `duplicateOf` seul (sans `state`) ; Linear ferme une issue au merge d'une PR dont la **branche** porte son identifiant ; aucun outil ne supprime une issue.

## Voie rapide

Review par **sonnet-reviewer** au lieu d'opus-advisor si le diff fait **30 lignes au plus** hors chemins sensibles (`processGate.fastLane.sensitivePaths`) et que tests, build ou lint passent. Commentaire : `<!-- review-rapide -->`, ligne `Tests : <commandes et résultat>` obligatoire, `Verdict : OK` (format dans `agents/sonnet-reviewer.md`). Le reste du process est dû.

## Briefs des sous-agents

- Brief autonome : objectif, fichiers, contraintes, critère de réussite vérifiable ; pas toute la conversation.
- Haiku : objectif tenable en ~10 itérations (sinon découper), 10 itérations max puis rapport ou `ESCALATE:`. haiku-scout lit les gros fichiers et logs et rend ~10 lignes ; l'orchestrateur ne lit pas de pavés.
- Escalade : haiku-builder (`ESCALATE:` ou 2 échecs) → sonnet-builder (`ESCALADE:` + acquis) → relance unique en effort high → opus-advisor.
- Admis hors graphe : `fr-reviewer`, `linear-planner`, `Explore`, `Plan`, `claude-code-guide` ; agents d'autres plugins refusés par `routing-guard`.
- L'orchestrateur garde l'utilisateur, Linear, la PR, la CI, les réponses et la synthèse ; conception, arbitrages et review vont à opus-advisor ; un sous-agent signale un bug hors périmètre (`HORS PÉRIMÈTRE:`), l'orchestrateur ouvre l'issue.

## Hooks

Réglages dans `hooks/hooks-config.json` (surcharge : `${CLAUDE_PLUGIN_DATA}/hooks-config.local.json`, fusion de premier niveau). Un refus n'est ni une erreur ni un point d'arrêt : lire sa raison, appliquer l'alternative qu'il donne (relecteur refusé → sonnet-reviewer ou opus-advisor) et continuer le process.

- **process-gate** : refuse `git commit` sur `main` ou sans identifiant d'issue en tête de branche (`issueKeyPattern`), `gh pr create` sans cet identifiant dans le titre ou le corps, **tout merge par l'agent** (`gh pr merge`, `gh api …/merge`) tant que `agentMerge` n'est pas `true` (puis review fraîche et checks verts exigés), un déploiement hors de `main` à jour ; avec `LINEAR_API_KEY`, vérifie que l'issue existe.
- **tool-guard** : appel répété 3 fois (changer d'approche), budget d'appels par sous-agent, lectures et recherches trop larges, sorties énormes (filtrer ou déléguer à haiku-tools) ; relancer le même appel force le passage. **deny-list** : commandes destructrices de `toolGuard.denyCommands`.
- **context-budget** : 200k tokens délègue, 300k passation dans `~/.claude/handoffs/<projet>.md`, 400k message bloqué une fois (passation puis `/clear`), avec une ligne `/compact garde : …` prête à coller.
- **ci-gate** : refuse le passage d'une issue en `In Review` si aucun `gh pr checks`, lancé dans un appel séparé, n'a démarré après la fin du dernier `git push`, ou si ce contrôle n'est pas vert.
- **routing-guard** : refuse les agents hors graphe qui hériteraient d'Opus ; un agent du dépôt sans `model:`, ou un appel avec `model:` explicite non-Opus, passe.
- **handoff** / **pre-compact** : recharge la passation au démarrage ; la rafraîchit avant un compactage (bloc `<!-- precompact -->`). **model-router** : rappel `[Routage]` une fois par session. **model-check** : avertit hors `orchestratorModel`.
- Interrupteurs : `TOOL_GUARD`, `CONTEXT_BUDGET`, `HANDOFF`, `PROCESS_GATE`, `MODEL_CHECK`, `DENY_LIST`, `CI_GATE` à `off`.
