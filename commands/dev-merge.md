---
description: "Demander et executer le merge d'une PR apres validation"
argument-hint: "Numero de PR (optionnel)"
allowed-tools: Bash(gh pr merge:*), Bash(gh pr view:*), Bash(git checkout:*), Bash(git pull:*), Bash(git branch:*)
---

# Merge de Pull Request

Finalise le processus en demandant la validation pour merger la PR.

## Contexte

- Argument : $ARGUMENTS
- Branche actuelle : !`git branch --show-current`
- PR : !`gh pr view --json number,title,url,state,reviewDecision,mergeable 2>/dev/null || echo "Pas de PR"`

## Workflow

1. **Verifier l'etat de la PR**
   - La PR est-elle approuvee ?
   - Y a-t-il des commentaires non resolus ?
   - Les checks CI passent-ils ?
   - Y a-t-il des conflits ?

2. **Presenter le statut a l'utilisateur**
   ```
   PR #XX : [titre]
   - Statut : [approuvee/en attente/changements demandes]
   - Commentaires non resolus : X
   - Checks CI : [pass/fail/pending]
   - Conflits : [oui/non]
   ```

3. **Demander confirmation**
   - Si tout est OK : "La PR est prete a etre mergee. Je merge ?"
   - Si problemes : "Il reste des points a traiter avant le merge : [liste]"
   - Proposer le type de merge : squash (recommande), merge commit, rebase

4. **Executer le merge** (uniquement apres confirmation explicite)
   - `gh pr merge --squash` (ou autre selon le choix)
   - Verifier que le merge a reussi

5. **Nettoyage**
   - Revenir sur la branche principale : `git checkout main/master`
   - Mettre a jour : `git pull`
   - Proposer de supprimer la branche locale

6. **Mettre a jour Linear**
   - Passe l'issue en "Done" via `linear issue update MVP-XX --status "Done"`
   - Ajoute un commentaire : "PR mergee. Issue terminee."

7. **Confirmation finale**
   - "Issue MVP-XX terminee et PR #XX mergee avec succes !"
