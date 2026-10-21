---
description: "Implementer une issue avec des agents specialises"
argument-hint: "Identifiant de l'issue Linear (ex: MVP-42)"
---

# Implementation d'une issue

Lance des agents specialises (custom + built-in) pour implementer l'issue Linear specifiee.

## Contexte

- Issue : $ARGUMENTS
- Branche actuelle : !`git branch --show-current`
- Statut git : !`git status --short`

## Agents disponibles

### Agents custom du projet
- **`implementer`** : Dev senior, implementation avec Write/Edit/Bash
- **`fr-reviewer`** : Review en francais, Read-only
- **`linear-planner`** : Planification et decoupage

### Subagent types built-in
- **`feature-dev:code-explorer`** : Exploration profonde du codebase
- **`feature-dev:code-architect`** : Design d'architecture avec blueprint
- **`feature-dev:code-reviewer`** : Review technique detaillee

## Phase 1 : Recuperation du contexte

**Actions :**
1. Utilise `linear issue view MVP-XX` pour recuperer :
   - Titre et description de l'issue
   - Plan d'implementation (dans la description)
   - Sous-taches eventuelles
2. Identifie les fichiers et zones du code concernes
3. Presente un resume a l'utilisateur

## Phase 2 : Exploration du codebase (agents en parallele)

**IMPORTANT** : Lance ces agents en parallele dans le meme message (plusieurs `Agent` tool calls) :

1. **Agent `feature-dev:code-explorer`** (subagent built-in) :
   - Prompt : "Explore l'architecture de ce projet Next.js. Identifie les patterns, conventions de nommage, structure des composants, patterns de routing, et utilitaires reutilisables. Focus sur [zone impactee par l'issue]."
   - Objectif : comprendre les patterns existants

2. **Agent `feature-dev:code-explorer`** (subagent built-in) :
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
1. Lance un agent `feature-dev:code-architect` (subagent built-in) :
   - Prompt : "Design l'architecture pour implementer [issue] dans ce codebase Next.js. Voici le contexte : [resultats phase 2]. Propose un blueprint avec les fichiers a creer/modifier, les composants, les data flows."
2. Presente la proposition a l'utilisateur
3. Attend la validation avant de continuer

## Phase 4 : Implementation

**Actions :**
1. Lance un agent `implementer` (agent custom) avec le plan valide :
   - Prompt : "Implemente selon ce plan : [plan]. Contexte du codebase : [resultats exploration]. Conventions a respecter : [patterns identifies]."
2. Pour les implementations parallelisables (fichiers independants) :
   - Peut lancer plusieurs agents `implementer` en parallele
   - Chaque agent travaille sur un sous-ensemble de fichiers
3. Respecte strictement les conventions du projet
4. Informe l'utilisateur de la progression a chaque etape significative

## Phase 5 : Validation (agents en parallele)

**IMPORTANT** : Lance ces agents de validation en parallele :

1. **Agent `feature-dev:code-reviewer`** (subagent built-in) :
   - Prompt : "Review les changements suivants : [liste fichiers modifies]. Cherche bugs, problemes de securite, performance, et coherence avec le reste du codebase."

2. **Agent `fr-reviewer`** (agent custom) :
   - Prompt : "Review en francais les fichiers suivants : [liste]. Produis un rapport avec le scoring de confiance."

**Synthese** : Combine les deux rapports et :
- Corrige les problemes critiques identifies (confiance >= 80%)
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
- Toujours lancer les agents independants en parallele pour gagner du temps
