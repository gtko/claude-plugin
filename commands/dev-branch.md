---
description: "Creer une branche git liee a une issue Linear"
argument-hint: "Identifiant de l'issue Linear (ex: MVP-42)"
allowed-tools: Bash(git checkout:*), Bash(git branch:*), Bash(git fetch:*), Bash(git status:*)
---

# Creation de branche

Cree une branche git liee a une issue Linear.

## Contexte

- Issue Linear : $ARGUMENTS
- Branche actuelle : !`git branch --show-current`
- Statut git : !`git status --short`

## Convention de nommage

Format : `feat/<ID-linear>-<description-courte>`

Exemples :
- `feat/MVP-42-ajout-systeme-auth`
- `fix/MVP-15-correction-bug-login`
- `refactor/MVP-8-restructuration-api`

Prefixes selon le type :
- `feat/` : nouvelle fonctionnalite
- `fix/` : correction de bug
- `refactor/` : refactoring
- `chore/` : tache technique
- `docs/` : documentation

## Workflow

1. **Verifier l'etat du repo**
   - S'assurer qu'il n'y a pas de changements non commites
   - Si changements en cours, demander a l'utilisateur quoi faire (stash, commit, abandon)

2. **Recuperer l'info de l'issue**
   - Utilise `linear issue view MVP-XX` pour recuperer le titre et le type de l'issue
   - Determine le prefixe (feat/fix/refactor/chore/docs) selon le contenu

3. **Creer la branche**
   - Se mettre sur la branche principale (main/master)
   - `git fetch origin`
   - `git checkout -b <nom-branche>` depuis la branche principale a jour

4. **Mettre a jour Linear**
   - Passe l'issue en statut "In Progress" via `linear issue update MVP-XX --status "In Progress"`
   - Ajoute un commentaire : "Branche creee : `<nom-branche>`"

5. **Confirmation**
   - Affiche : "Branche `<nom-branche>` creee et liee a l'issue $ARGUMENTS"
   - Retourne le nom de la branche
