---
description: "Creer la PR liee a une issue Linear (Fixes <ID>, plan de test), la faire relire et suivre la CI"
argument-hint: "Identifiant de l'issue Linear (ex: MVP-42)"
allowed-tools: Bash(git status:*), Bash(git log:*), Bash(git diff:*), Bash(git branch:*), Bash(git fetch:*), Bash(git push:*), Bash(gh pr create:*), Bash(gh pr view:*), Bash(gh pr checks:*), Bash(gh pr comment:*), Bash(gh run view:*), Bash(gh run rerun:*)
---

# Creation de Pull Request

Issue : $ARGUMENTS — skill `livraison`, etapes 7 a 11.

1. Prerequis mesures : tout commite, gate locale verte sur ce head, branche a jour avec la base, pas de PR existante.
2. Titre `<type>(domaine): description (<CLE>-XXXX)`. Corps (`--body-file`) : `Fixes <CLE>-XXXX` en premiere ligne (ou le mot-cle impose par la doc du depot), `## Resume`, `## Diagnostic` (bug), `## Fix`, `## Plan de test` (table verification → resultat, ce qui n'est pas verifie), issues hors perimetre, ligne d'attribution de la session.
3. `git push -u` (attendre sa fin), puis `gh pr create`, lien de la PR commente sur l'issue. La PR n'est pas encore declaree prete.
4. `/dev-review` (review sur la PR), puis apres chaque push termine `gh pr checks --watch` dans un appel separe (jamais dans la meme commande ni le meme lot que le push), `/dev-fix-review` pour les retours PR et Linear.
5. Prete (review OK apres le dernier commit, CI verte sur le dernier commit pousse, `git rev-parse HEAD` = `headRefOid`, retours traites) : commentaire Linear « PR prete, en attente de merge », issue `In Review` si elle n'y est pas deja. Jamais de merge.
