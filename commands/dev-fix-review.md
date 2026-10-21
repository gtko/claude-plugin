---
description: "Traiter les retours d'une PR et de son issue Linear : corriger les bloquants, contester ce qui contredit la spec, repondre en FR, puis CI"
argument-hint: "Numero de PR (optionnel, utilise la PR de la branche courante)"
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git push:*), Bash(git diff:*), Bash(git fetch:*), Bash(git merge:*), Bash(gh pr view:*), Bash(gh pr checks:*), Bash(gh run view:*), Bash(gh run rerun:*), Bash(gh api:*), Bash(gh pr comment:*)
---

# Traitement des retours de review

Traite les retours sur la PR **et** sur son issue Linear (skill `livraison`, etapes 9 et 10) : corrige les bloquants, conteste avec justification ce qui contredit la spec, repond en francais, puis suit la CI.

## Contexte

- Argument : $ARGUMENTS
- Branche actuelle : !`git branch --show-current`
- PR en cours : !`gh pr view --json number,title,url 2>/dev/null || echo "Pas de PR trouvee"`

## Phase 1 : Lecture des retours

1. Commentaires de la PR :
   - `gh pr view <pr> --comments`
   - `gh api repos/{owner}/{repo}/pulls/{pr_number}/comments` (commentaires de ligne)
   - `gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews`
2. Issue Linear (identifiant dans la branche ou le titre) : connecteur MCP `get_issue` et `list_comments`. Le besoin a pu changer depuis l'ouverture de la PR.
3. Categoriser chaque retour :
   - **Bloquant** : bug, demande de changement conforme a la spec et aux criteres
   - **Contraire a la spec** : suggestion qui contredit la doc du domaine (`docs/`, ADR), les regles du depot ou les criteres d'acceptation
   - **Besoin modifie** (commentaire Linear) : a integrer, criteres et plan de test mis a jour
   - **Question** ; **suggestion optionnelle** ; **approbation**
4. Presenter un resume

## Phase 2 : Traitement

### Bloquants et besoin modifie
1. Lire le fichier et la regle concernes
2. Corriger (un commit par retour : `fix(domaine): description (<CLE>-XXXX)`), avec un test qui echouerait sans le correctif
3. Repondre sur la PR (ou au fil : `gh api repos/{owner}/{repo}/pulls/{pr_number}/comments/{id}/replies -f body=...`) : « Corrige dans <sha> : <ce qui a ete fait> »

### Suggestion contraire a la spec ou a un ADR
1. **Ne pas l'appliquer**
2. Repondre avec la justification et la reference exacte (fichier, section, critere) : « Non applique : <raison>, voir <docs/...> »

### Questions et suggestions optionnelles
- Repondre clairement ; suggestion appliquee : la citer avec son commit ; refusee : dire pourquoi
- Un retour ambigu se clarifie aupres de son auteur ou de l'utilisateur ; aucun retour n'est ignore sans reponse

## Phase 3 : Gate, review et push

1. Gate locale : tests ET lint (et build s'il existe), verts
2. Correctif qui touche du fond : nouvelle review par un sous-agent sur les axes concernes, postee en commentaire apres le dernier commit
3. Branche en retard sur la base : `git fetch origin && git merge refs/remotes/origin/<base> --no-edit`, gate locale
4. Push

## Phase 4 : CI et recapitulatif

1. `gh pr checks <pr> --watch` apres ce push
   - Echec d'infrastructure (runner perdu, timeout reseau, service indisponible) : `gh run rerun <id> --failed`, **sans modifier le code**, puis reconsulter
   - Echec reel : `gh run view <id> --log-failed`, corriger, reprendre la Phase 3
2. Commentaire general sur la PR :
   ```
   Retours traites :
   - [x] <retour 1> : corrige dans <sha>
   - [x] <retour 2> : non applique, contraire a <reference> (justification en reponse)
   - [x] <question 3> : repondu
   ```
3. Relire une derniere fois les commentaires de la PR et de l'issue Linear : nouveau retour -> Phase 2
4. Plus rien d'ouvert et CI verte : commentaire Linear « PR prete, en attente de merge », issue en `In Review` si elle n'y est pas deja. Jamais de merge.

## Notes

- Toutes les reponses sont en **francais**, respectueuses et argumentees
- Un commentaire de review n'est pas un ordre : la spec et les ADR font foi
