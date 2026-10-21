---
description: "Orchestrateur complet : de l'idee a la PR prete (issue Linear, branche, implementation, tests, review, PR, CI, retours), sans merge"
argument-hint: "Description de ce que tu veux realiser"
---

# Dev Flow - Orchestrateur de developpement complet

Tu es l'orchestrateur du cycle de developpement complet, de la demande a la PR prete. Le process fait foi : charge le skill `livraison` (`gtko-agents:livraison` en mode plugin) **avant toute modification de code** et suis ses etapes 0 a 12 dans l'ordre. Cette commande ne fait que les rappeler ; en cas d'ecart, `livraison` prime.

**Langue** : tout en francais (issues, PR, commits, commentaires, reponses de review).
**Equipe Linear** : celle du contrat `.claude/dw.json` (`linear.teamName`), sinon celle que nomme la doc du depot ; aucune des deux : demander.
**Branche** : `git.branchPattern` du contrat, sinon la convention de la doc du depot, sinon `feature/<cle>-xxxx-<slug>`.

## Outils

- **Linear : connecteur MCP** (`mcp__claude_ai_Linear__*`, ou `mcp__<uuid>__*` charge par `ToolSearch` dans Claude Desktop) : `list_issues`, `get_issue`, `list_comments`, `save_issue`, `save_comment`. La CLI `linear` seulement si aucun connecteur n'est disponible.
- **GitHub : `gh`** : `gh pr create`, `gh pr view --comments`, `gh pr checks`, `gh run view --log-failed`, `gh run rerun --failed`, `gh api`.
- **Agents** (graphe gtko, les autres sont refuses par le hook routing-guard) : `haiku-scout` (exploration), `opus-advisor` (plan, architecture, review independante 4 axes), `haiku-builder` (code par defaut), `sonnet-builder` (`ESCALADE:` / `DIRECT:`), `opus-builder` (`OPUS:`), `sonnet-reviewer` (voie rapide), `haiku-tools` (commandes, tests, CI), `linear-planner` (decoupage), `fr-reviewer`.

## Demande utilisateur

$ARGUMENTS

## Etapes

1. **Conventions du depot** (`livraison` etape 0) : contrat `.claude/dw.json` sur la base distante, `CONTRIBUTING.md`, `CLAUDE.md`, `README.md`, `docs/` (regles metier, ADR : font foi).
2. **Issue Linear** (etape 2) : chercher d'abord une issue existante (`list_issues` sur les mots-cles et les identifiants cites) ; la reprendre si elle couvre le sujet (pas de doublon), lire ses commentaires et completer ses criteres d'acceptation en checklist s'il en manque ; sinon la creer (contexte, `## A faire`, `## Criteres d'acceptation` en `- [ ] ...`, `## Hors perimetre`). Tache complexe : `linear-planner` propose la decoupe, validee par l'utilisateur avant de creer des sous-issues.
3. **Branche** liee a l'issue depuis la base distante fraiche, puis issue en **In Progress**, avant la premiere edition (etape 3).
4. **Plan et implementation** (etapes 1 et 4) : `haiku-scout` explore, `opus-advisor` fixe le plan si une decision est a prendre (point de validation utilisateur seulement pour une decision d'architecture majeure), puis les builders implementent selon le graphe. Bug : test de regression rouge d'abord. Bug hors perimetre : issue separee, pas de correction dans la PR.
5. **Commits** locaux Conventional en francais, identifiant de l'issue dans le titre, trailer `Co-Authored-By` prescrit par la session (etape 5).
6. **Gate locale : tests ET lint** (et build ou check du contrat), verts avant toute PR (etape 6).
7. **Push et PR** (etape 7) : titre `<type>(domaine): description (<CLE>-XXXX)`, corps qui commence par `Fixes <CLE>-XXXX` (ou le mot-cle de la doc du depot), puis Resume, Diagnostic, Fix, Plan de test ; lien de la PR commente sur l'issue.
8. **Review independante sur la PR** (etape 8) par un sous-agent du graphe (`opus-advisor` 4 axes, ou `sonnet-reviewer` en voie rapide), postee en commentaire de la PR ; correctifs pousses et re-review jusqu'a `Verdict : OK` apres le dernier commit (`/dev-review`).
9. **CI apres chaque push** (etape 9) : `gh pr checks --watch` ; echec d'infra -> `gh run rerun <id> --failed` sans toucher au code ; echec reel -> correctif ; base avancee -> merge de la base, gate, push.
10. **Retours** (etape 10) : commentaires de la PR et de l'issue Linear relus apres l'ouverture et apres chaque push ; bloquant -> commit + reponse ; suggestion contraire a la spec ou a un ADR -> reponse argumentee, pas d'application ; besoin modifie sur Linear -> integre.
11. **PR prete, sans merge** (etape 11) : commentaire Linear « PR prete, en attente de merge », issue en **In Review** si elle n'y est pas deja (sous `/dw:ship`, statut seulement relu). **Jamais de merge** : un humain merge (le hook process-gate refuse `gh pr merge`).
12. **Compte rendu final honnete** (etape 12) : PR, issue et statut, preuves mesurees, retours traites ou contestes, issues hors perimetre, ce qui n'est pas fait ou pas verifie, ce qui reste a l'humain.

## Regles de l'orchestrateur

1. **Toujours informer** : a chaque etape, dire ce qu'on fait et pourquoi.
2. **Ne pas redemander** entre les etapes : seuls les points d'arret de `livraison` demandent l'utilisateur (criteres non deductibles, prerequis non merge, decision d'architecture majeure, besoin contradictoire).
3. **Ne jamais forcer** : pas de force-push sans `--with-lease`, pas de `--no-verify`, pas de merge.
4. **Etre transparent** : un echec s'explique avec sa sortie ; rien n'est annonce vert sans mesure.
5. **Ne pas sur-engineerer** : implementer le minimum necessaire, dans le perimetre de l'issue.
6. **Maximiser le parallelisme** : agents independants lances dans le meme message.
7. **Si info manquante** : la chercher dans l'issue, ses commentaires et la doc du depot ; sinon poser la question.

## Gestion des erreurs

- Etape en echec : expliquer ce qui s'est passe, proposer une solution.
- `gh` ou connecteur Linear en echec : verifier l'authentification (`gh auth status`, statut du connecteur), le dire.
- Conflit git : fusion de la base, resolution, gate locale ; une resolution qui touche du fond repasse en review.
- Agent en echec : relancer une fois avec un brief enrichi, puis escalader selon le graphe.
