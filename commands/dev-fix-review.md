---
description: "Traiter les retours d'une PR et de son issue Linear : corriger les bloquants, contester ce qui contredit la spec, repondre, puis CI"
argument-hint: "Numero de PR (optionnel, utilise la PR de la branche courante)"
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git push:*), Bash(git diff:*), Bash(git fetch:*), Bash(git merge:*), Bash(gh pr view:*), Bash(gh pr checks:*), Bash(gh run view:*), Bash(gh run rerun:*), Bash(gh api:*), Bash(gh pr comment:*)
---

# Traitement des retours

PR : $ARGUMENTS — skill `livraison`, etapes 9 et 10. Reponses en francais.

1. Lire : `gh pr view <pr> --comments`, `gh api repos/{owner}/{repo}/pulls/{pr}/comments` et `.../reviews`, puis l'issue Linear (`get_issue` + `list_comments`) : le besoin a pu changer.
2. Par retour :
   - bloquant ou besoin modifie : commit de correction (avec un test qui echouerait sans lui) **et** reponse sur la PR citant le commit ;
   - suggestion contraire a la spec, a un ADR ou aux criteres : ne pas l'appliquer, repondre avec la justification et la reference ;
   - question ou suggestion optionnelle : repondre ; aucun retour sans reponse.
3. Gate locale, re-review si le correctif touche du fond, base en retard : `git merge refs/remotes/origin/<base> --no-edit`, push.
4. `gh pr checks <pr> --watch` : echec d'infra → `gh run rerun <id> --failed` sans toucher au code ; echec reel → corriger et reprendre en 3.
5. Recap sur la PR (retour → commit ou raison), relire PR et issue une derniere fois. Plus rien d'ouvert et CI verte : commentaire Linear « PR prete, en attente de merge », issue `In Review` si besoin. Jamais de merge.
