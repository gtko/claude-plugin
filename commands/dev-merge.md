---
description: "Verifier qu'une PR est prete et la remettre a l'humain (le merge reste un geste humain)"
argument-hint: "Numero de PR (optionnel)"
allowed-tools: Bash(gh pr view:*), Bash(gh pr checks:*), Bash(git fetch:*), Bash(git branch:*), Bash(git merge-base:*)
---

# Preparation du merge

PR : $ARGUMENTS — skill `livraison`, etape 11. L'agent ne merge pas : `process-gate` refuse `gh pr merge` et `gh api .../merge` tant que `processGate.agentMerge` n'est pas `true`.

1. Mesurer : review OK (`<!-- review-4-axes -->` ou `<!-- review-rapide -->`) postee apres le dernier commit, retours PR et Linear traites, `gh pr checks` vert apres le dernier push, `mergeStateStatus` ni `BEHIND` ni en conflit.
2. Points restants : les lister et proposer `/dev-fix-review`. Tout est pret : commentaire Linear « PR prete, en attente de merge », issue `In Review` si besoin, URL remise a l'humain.
3. Apres un merge humain, sur demande : verifier `MERGED`, issue `Done` si `Fixes` ne l'a pas fait, `git switch main && git pull --ff-only`.
