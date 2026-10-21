---
description: "Review complete d'une Pull Request"
argument-hint: "Numero de PR ou branche (optionnel, utilise la branche courante par defaut)"
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git status:*), Bash(git branch:*), Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh api:*)
---

# Review de Pull Request

Effectue une review complete de la PR en utilisant des agents specialises en parallele.

## Contexte

- Argument : $ARGUMENTS
- Branche actuelle : !`git branch --show-current`
- PR en cours : !`gh pr view --json number,title,url,body 2>/dev/null || echo "Pas de PR trouvee"`

## Agents disponibles

### Agents custom du projet
- **`fr-reviewer`** : Review en francais avec scoring de confiance (Read-only)

### Subagent types built-in
- **`pr-review-toolkit:code-reviewer`** : Review code complete (qualite, securite, conventions)
- **`pr-review-toolkit:silent-failure-hunter`** : Detection erreurs silencieuses et error handling
- **`pr-review-toolkit:type-design-analyzer`** : Analyse de la qualite des types
- **`pr-review-toolkit:code-simplifier`** : Suggestions de simplification
- **`pr-review-toolkit:comment-analyzer`** : Qualite des commentaires et documentation

## Phase 1 : Collecte du contexte

**Actions :**
1. Recuperer la PR (depuis l'argument ou la branche courante)
2. Lire le diff complet de la PR
3. Identifier les fichiers modifies et leur nature

## Phase 2 : Review multi-agents (en parallele)

**IMPORTANT** : Lance tous ces agents en parallele dans le meme message (plusieurs `Agent` tool calls).

### Agent 1 : `pr-review-toolkit:code-reviewer` (subagent built-in)
- Prompt : "Review la PR sur la branche [branche]. Focus : bugs, securite OWASP, performance, conventions du projet Next.js/TypeScript/Tailwind."
- Objectif : qualite du code et securite

### Agent 2 : `pr-review-toolkit:silent-failure-hunter` (subagent built-in)
- Prompt : "Analyse les changements de la branche [branche] pour detecter les erreurs silencieuses, le mauvais error handling, et les fallbacks inappropries."
- Objectif : robustesse du code

### Agent 3 : `fr-reviewer` (agent custom)
- Prompt : "Review les fichiers modifies : [liste]. Produis un rapport en francais avec scoring de confiance. Focus : coherence architecturale, patterns, maintenabilite."
- Objectif : rapport en francais + coherence archi

### Agent 4 (background) : `pr-review-toolkit:code-simplifier` (subagent built-in, `run_in_background: true`)
- Prompt : "Analyse les fichiers modifies et propose des simplifications de code."
- Objectif : suggestions de simplification (non-bloquant)

### Agent 5 (conditionnel) : `pr-review-toolkit:type-design-analyzer` (si nouveaux types)
- Lance uniquement si de nouveaux types/interfaces sont introduits
- Prompt : "Analyse les nouveaux types introduits dans cette PR."

## Phase 3 : Synthese

Combine les rapports des agents 1, 2 et 3 (+ 4 et 5 si disponibles) en un rapport unifie.

**Format du rapport (en francais) :**

```markdown
# Rapport de Review - PR #XX

## Problemes critiques (a corriger avant merge)
- **[Source: agent]** [fichier:ligne] Description du probleme
  - Suggestion de correction

## Problemes importants (a corriger)
- **[Source: agent]** [fichier:ligne] Description
  - Suggestion

## Erreurs silencieuses detectees
- [fichier:ligne] Description du risque
  - Correction recommandee

## Suggestions de simplification
- [fichier:ligne] Amelioration proposee

## Points positifs
- Ce qui est bien fait dans cette PR

## Verdict
[ ] Pret pour merge
[ ] A corriger (problemes critiques)
[ ] A revoir (problemes importants)
```

## Phase 4 : Action

**Actions :**
1. Presenter le rapport a l'utilisateur
2. Demander : "Veux-tu que je corrige les problemes identifies ?"
3. Si oui, lancer un agent `implementer` (custom) pour appliquer les corrections, puis passer au skill `/dev-fix-review`
