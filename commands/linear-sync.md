---
description: "Synchronisation Linear : chercher une issue existante (pas de doublon), sinon la creer avec ses criteres en checklist, planifier, decouper"
argument-hint: "Description de la fonctionnalite ou de la tache"
---

# Synchronisation Linear

Tu geres l'issue Linear de la demande (skill `livraison`, etape 2).

- **Equipe** : celle que nomme la doc du depot ; sinon, demander.
- **Outils** : connecteur MCP Linear (`mcp__claude_ai_Linear__*`, ou `mcp__<uuid>__*` charge par `ToolSearch` dans Claude Desktop) : `list_issues`, `get_issue`, `list_comments`, `save_issue`, `save_comment`, `list_projects`. La CLI `linear` seulement si aucun connecteur n'est disponible.
- Titres, descriptions et commentaires en **francais**.

## Contexte

Demande utilisateur : $ARGUMENTS

## Phase 1 : Recherche d'issue existante (toujours d'abord)

1. `list_issues` dans l'equipe, sur plusieurs mots-cles du sujet (ecran, composant, symptome) et sur tout identifiant cite dans la demande
2. Lire les candidates (`get_issue`, `list_comments`)
3. Une issue couvre le sujet : la **reprendre**, ne pas en creer de seconde
   - L'afficher (identifiant, statut, description, commentaires utiles)
   - Sans criteres d'acceptation en checklist : ajouter a sa description une section `## Criteres d'acceptation` (`- [ ] ...`), sans toucher au reste ni au perimetre, et le dire en commentaire, s'ils se deduisent de la demande, de l'issue et de ses commentaires ; sinon les demander
   - Ligne `Criteres a preciser :` : stop, demander les criteres
4. Une issue proche mais distincte : creer la nouvelle et les lier (`relatedTo`)
5. Aucune issue : Phase 2

## Phase 2 : Creation de l'issue

1. Titre court, qui decrit le livrable
2. Description structuree :
   - **Contexte** en 1 a 3 phrases (faits, references, fichiers)
   - `## A faire` : actions convenues
   - `## Criteres d'acceptation` **en checklist** `- [ ] ...`, testables, derives de la demande, jamais inventes ; non deductibles : les demander
   - `## Hors perimetre` si quelque chose est exclu
3. Champs : priorite seulement si la demande en fixe une ; label seulement parmi ceux qui existent dans l'equipe, **jamais de label cree** ; projet seulement s'il est nomme (demande ou doc du depot)
4. Creer l'issue (`save_issue`) sans redemander quand la demande est claire ; afficher l'identifiant cree (ex. MVP-42)

## Phase 3 : Planification et decoupe

1. Tache simple : plan d'implementation ajoute a la description
2. Tache complexe : agent `linear-planner` pour une decoupe en 3 a 7 sous-issues independamment testables, chacune avec ses criteres ; confirmer le decoupage avec l'utilisateur avant de creer plusieurs issues, puis les creer liees a l'issue parente

## Phase 4 : Confirmation

1. Recapitulatif : issue principale (identifiant, titre, reprise ou creee), sous-issues eventuelles, champs poses
2. Suite du process : branche liee a l'issue et passage en `In Progress` avant la premiere modification de code (`/dev-branch`)

## Notes importantes

- Doublons d'abord : une issue existante se reprend ou se complete, jamais de doublon
- Un bug repere hors du perimetre de la tache : issue separee, liee par `relatedTo`
- Si l'utilisateur corrige un titre ou une description, appliquer immediatement
