---
description: "Creer une branche git liee a une issue Linear et passer l'issue In Progress"
argument-hint: "Identifiant de l'issue Linear (ex: MVP-42)"
allowed-tools: Bash(git checkout:*), Bash(git switch:*), Bash(git branch:*), Bash(git fetch:*), Bash(git status:*)
---

# Creation de branche

Issue : $ARGUMENTS — skill `livraison`, etape 3. Branche actuelle : !`git branch --show-current`

1. Arbre sale, issue d'une autre equipe, ou branche / PR deja existante pour l'issue : montrer l'etat et demander.
2. Nom : convention de la doc du depot (ex. `<ID>-<slug>`), sinon `feature/<cle>-xxxx-<slug>`. L'identifiant y est toujours : `process-gate` refuse un commit sans lui.
3. `git fetch origin --prune && git switch -c <branche> refs/remotes/origin/<base>`.
4. Issue en `In Progress` (`save_issue`) avant toute modification de code, commentaire « Branche creee : `<branche>` ».
