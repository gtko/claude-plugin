---
description: "Implementer une issue avec des agents specialises"
argument-hint: "Identifiant de l'issue Linear (ex: MVP-42)"
---

# Implementation d'une issue

Lance les agents du graphe gtko pour implementer l'issue Linear specifiee (skill `livraison`, etapes 1 a 7). Prerequis : issue reprise ou creee avec ses criteres en checklist, branche liee a l'issue, issue en `In Progress` (sinon `/dev-branch` d'abord).

## Contexte

- Issue : $ARGUMENTS
- Branche actuelle : !`git branch --show-current`
- Statut git : !`git status --short`

## Agents disponibles

Seuls les agents du graphe sont admis (le hook routing-guard refuse les agents d'autres plugins) :
- **`haiku-scout`** : exploration, lecture, synthese (lecture seule)
- **`opus-advisor`** : plan, architecture, review independante 4 axes (lecture seule)
- **`haiku-builder`** : implementation par defaut ; `sonnet-builder` (`ESCALADE:` / `DIRECT:`), `opus-builder` (`OPUS:`, gros blocs UI)
- **`linear-planner`** : decoupage ; **`fr-reviewer`** : review en francais

## Phase 1 : Recuperation du contexte

**Actions :**
1. Connecteur MCP Linear `get_issue` et `list_comments` pour recuperer :
   - Titre, description et criteres d'acceptation de l'issue
   - Plan d'implementation (dans la description) et commentaires qui precisent le besoin
   - Sous-taches eventuelles
   - Verifier que l'issue est `In Progress` et que la branche courante porte son identifiant
2. Identifie les fichiers et zones du code concernes
3. Presente un resume a l'utilisateur

## Phase 2 : Exploration du codebase (agents en parallele)

**IMPORTANT** : Lance ces agents en parallele dans le meme message (plusieurs `Agent` tool calls) :

1. **Agent `haiku-scout`** :
   - Prompt : "Explore l'architecture du projet et sa doc (CONTRIBUTING.md, CLAUDE.md, docs/, ADR). Identifie les patterns, conventions, regles de code, chemins geles et utilitaires reutilisables. Focus sur [zone impactee par l'issue]. Synthese en 10 lignes."
   - Objectif : comprendre les patterns et les regles existants

2. **Agent `haiku-scout`** :
   - Prompt : "Identifie tous les fichiers qui seront impactes par [description de l'issue]. Trace les dependances, les imports, et les composants lies."
   - Objectif : mapper les fichiers a modifier

3. **Agent `linear-planner`** (agent custom, `run_in_background: true`) :
   - Prompt : "Analyse cette issue et propose un decoupage technique : [contexte issue]"
   - Objectif : avoir un plan structure

**Synthese** : Combine les resultats des 3 agents pour identifier :
- Les fichiers a creer
- Les fichiers a modifier
- Les dependances a ajouter
- Le plan d'implementation ordonne

## Phase 3 : Design d'architecture (si complexe)

**Actions :**
1. Lance un agent `opus-advisor` :
   - Prompt : "Plan d'implementation de [issue] dans ce codebase. Contexte : [resultats phase 2]. Lots verifiables, agent recommande, fichiers a creer/modifier, criteres de reussite."
2. Decision d'architecture majeure : presente la proposition et attends la validation ; sinon continuer

## Phase 4 : Implementation

**Actions :**
1. Lance un agent `haiku-builder` avec le plan :
   - Prompt : "Implemente selon ce plan : [plan]. Contexte du codebase : [resultats exploration]. Conventions et regles a respecter : [patterns, chemins geles, doc qui fait foi]. Bug : test de regression rouge d'abord. Critere de reussite : [tests et lint verts]."
2. Pour les implementations parallelisables (fichiers independants) :
   - Peut lancer plusieurs agents `haiku-builder` en parallele (un worktree par lot)
   - Chaque agent travaille sur un sous-ensemble de fichiers
3. Respecte strictement les conventions du projet
4. Informe l'utilisateur de la progression a chaque etape significative

## Phase 5 : Validation (agents en parallele)

**IMPORTANT** : Lance ces agents de validation en parallele :

0. **Gate locale** : tests ET lint (et build ou `commands.check`), verts avant la review.

1. **Agent `fr-reviewer`** (controle rapide avant la PR, si utile) :
   - Prompt : "Review en francais les fichiers suivants : [liste]. Produis un rapport avec le scoring de confiance."

La review independante qui fait foi se fait **sur la PR** (`/dev-pr` puis `/dev-review`, opus-advisor 4 axes).

**Synthese** :
- Corrige les problemes critiques identifies
- Presente un recapitulatif :
  - Fichiers crees/modifies
  - Decisions techniques prises
  - Tests ajoutes
  - Points d'attention
  - Problemes mineurs non corriges (pour info)

## Notes

- Demander a l'utilisateur avant de prendre des decisions architecturales majeures
- Si un blocage technique survient, expliquer et proposer des alternatives
- Ne pas over-engineer : implementer le minimum necessaire
- Mettre a jour les sous-taches Linear au fur et a mesure
- Bug repere hors du perimetre : issue separee, pas de correction dans cette branche
- Suite : `/dev-commit`, puis `/dev-pr` (PR, CI, retours) ; jamais de merge
- Toujours lancer les agents independants en parallele pour gagner du temps
