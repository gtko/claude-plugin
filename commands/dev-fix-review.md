---
description: "Traiter les retours de review : repondre en FR, resoudre les commentaires, corriger le code"
argument-hint: "Numero de PR (optionnel, utilise la PR de la branche courante)"
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git push:*), Bash(git diff:*), Bash(gh pr view:*), Bash(gh api:*), Bash(gh pr comment:*)
---

# Traitement des retours de review

Traite les commentaires de review sur la PR : repond en francais, corrige le code, resout les discussions.

## Contexte

- Argument : $ARGUMENTS
- Branche actuelle : !`git branch --show-current`
- PR en cours : !`gh pr view --json number,title,url 2>/dev/null || echo "Pas de PR trouvee"`

## Phase 1 : Lecture des commentaires

**Actions :**
1. Recuperer tous les commentaires de review :
   - `gh api repos/{owner}/{repo}/pulls/{pr_number}/comments`
   - `gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews`
2. Categoriser les commentaires :
   - **Corrections demandees** : changements de code requis
   - **Questions** : demandes de clarification
   - **Suggestions** : ameliorations optionnelles
   - **Approuves** : commentaires positifs
3. Presenter un resume a l'utilisateur

## Phase 2 : Traitement des commentaires

Pour chaque commentaire necessitant une action :

### Corrections de code
1. Lire le fichier concerne
2. Comprendre la demande
3. Appliquer la correction
4. Repondre au commentaire en francais :
   - "Corrige : [explication de ce qui a ete fait]"
   - Ou "Non corrige : [justification technique]" si la correction n'est pas pertinente

### Questions
1. Formuler une reponse claire en francais
2. Poster la reponse via `gh api`

### Suggestions
1. Evaluer la pertinence
2. Si appliquee : "Bonne idee, c'est applique !"
3. Si refusee : "Merci pour la suggestion. Je ne l'applique pas car [raison]"

## Phase 3 : Commit des corrections

**Actions :**
1. Stage les fichiers modifies
2. Commit avec message :
   ```
   fix(review): corrections suite a la review PR #XX

   - Correction 1
   - Correction 2

   Ref: MVP-XX
   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
   ```
3. Push sur la branche

## Phase 4 : Resolution des discussions

**Actions :**
1. Pour chaque commentaire traite, marquer la discussion comme resolue si possible
2. Poster un commentaire general sur la PR :
   ```
   Corrections appliquees suite a la review :
   - [x] Commentaire 1 : corrige
   - [x] Commentaire 2 : corrige
   - [x] Question 3 : repondu
   - [ ] Suggestion 4 : non appliquee (justification)

   Pret pour une nouvelle review !
   ```

## Phase 5 : Verification

**Actions :**
1. Lancer une review rapide des corrections appliquees
2. S'assurer qu'aucune regression n'a ete introduite
3. Informer l'utilisateur : "Toutes les corrections sont appliquees et pushees. Pret pour re-review."

## Notes

- Toutes les reponses aux commentaires sont en **francais**
- Etre respectueux et constructif dans les reponses
- Si un commentaire est ambigu, demander clarification a l'utilisateur
- Ne jamais ignorer un commentaire sans l'expliquer
