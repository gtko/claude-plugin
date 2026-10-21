---
description: "Creer une Pull Request liee a une issue Linear"
argument-hint: "Identifiant de l'issue Linear (ex: MVP-42)"
allowed-tools: Bash(git status:*), Bash(git log:*), Bash(git diff:*), Bash(git branch:*), Bash(git push:*), Bash(gh pr create:*), Bash(gh pr view:*)
---

# Creation de Pull Request

Cree une Pull Request GitHub liee a l'issue Linear.

## Contexte

- Issue : $ARGUMENTS
- Branche actuelle : !`git branch --show-current`
- Commits depuis la branche principale : !`git log main...HEAD --oneline 2>/dev/null || git log master...HEAD --oneline 2>/dev/null`

## Workflow

1. **Verifier les prerequis**
   - S'assurer que tous les changements sont commites
   - S'assurer que la branche est pushee sur le remote
   - Verifier qu'aucune PR n'existe deja pour cette branche

2. **Recuperer le contexte Linear**
   - Utilise `linear issue view MVP-XX` pour recuperer :
     - Titre et description de l'issue
     - Criteres d'acceptation
     - Sous-taches et leur statut

3. **Construire la PR**
   - Titre : reprend le titre de l'issue avec le prefixe conventionnel
     - Format : `feat(scope): titre de l'issue [MVP-XX]`
   - Corps de la PR en francais :
     ```markdown
     ## Resume
     <Description claire de ce qui a ete fait, 2-5 bullets>

     ## Issue Linear
     Lien vers l'issue : MVP-XX

     ## Changements
     <Liste des fichiers/modules modifies et pourquoi>

     ## Criteres d'acceptation
     <Checklist des criteres depuis l'issue Linear>
     - [ ] Critere 1
     - [ ] Critere 2

     ## Tests
     <Ce qui a ete teste et comment>

     ## Notes pour le reviewer
     <Points d'attention, decisions techniques, questions ouvertes>
     ```

4. **Creer la PR**
   - `gh pr create --title "..." --body "..."`
   - Ajouter les labels pertinents si disponibles
   - Ne pas assigner de reviewers sauf si demande

5. **Mettre a jour Linear**
   - Passe l'issue en statut "In Review" via `linear issue update MVP-XX --status "In Review"`
   - Ajoute un commentaire avec le lien de la PR

6. **Confirmation**
   - Affiche l'URL de la PR creee
   - Resume ce qui a ete inclus
