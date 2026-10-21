---
description: "Commit et push des changements lies a une issue, apres la gate locale (tests et lint)"
argument-hint: "Identifiant de l'issue Linear (ex: MVP-42) ou message de commit"
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git push:*), Bash(git diff:*), Bash(git log:*), Bash(npm run build:*), Bash(npm run lint:*), Bash(npm test:*), AskUserQuestion
---

# Commit et push

Argument : $ARGUMENTS — skill `livraison`, etapes 5 et 6. Branche : !`git branch --show-current`

1. **Gate locale bloquante** : tests ET lint (et build s'il existe), commandes de la doc du depot. Rouge : `haiku-builder` corrige, puis relancer ; pas de push.
2. **Dogfood** (app web) : serveur de dev lance, skill `dogfood` sur les pages touchees ; bugs critiques → `haiku-builder`, 3 iterations max puis l'utilisateur ; bugs mineurs → plan de test de la PR.
3. **Checklist manuelle** : `AskUserQuestion` (`multiSelect`, 2 a 4 items que le dogfood n'a pas pu verifier : ressenti UX, donnees reelles, device). Informative, non bloquante ; le resultat va au plan de test.
4. **Commit** : `type(scope): description (<CLE>-XXXX)` en francais, corps Avant / Apres, trailer `Co-Authored-By` de la session ; `git add` cible, jamais `--no-verify`.
5. **Push**, puis, le push termine et si une PR existe : `gh pr checks <pr> --watch` dans un appel separe (echec d'infra : `gh run rerun <id> --failed`, sans toucher au code) et `/dev-fix-review`.
6. Commentaire de suivi sur l'issue (`save_comment`) ; jamais `Done` sans merge.
