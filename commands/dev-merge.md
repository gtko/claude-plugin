---
description: "Verifier qu'une PR est prete a merger et la remettre a l'humain (le merge reste un geste humain)"
argument-hint: "Numero de PR (optionnel)"
allowed-tools: Bash(gh pr view:*), Bash(gh pr checks:*), Bash(git fetch:*), Bash(git branch:*), Bash(git merge-base:*)
---

# Preparation du merge

Verifie que la PR est prete et la remet a l'humain. **Le merge est un geste humain** (regle Dotworld) : l'agent ne lance pas `gh pr merge`, et le hook process-gate le refuse tant que `processGate.agentMerge` n'est pas `true`. Sur un depot Dotworld a contrat, le seul merge par agent passe par `/dw:ship --auto-merge`, demande explicitement par l'humain, si le contrat l'autorise.

## Contexte

- Argument : $ARGUMENTS
- Branche actuelle : !`git branch --show-current`
- PR : !`gh pr view --json number,title,url,state,reviewDecision,mergeable,mergeStateStatus 2>/dev/null || echo "Pas de PR"`

## Workflow

1. **Mesurer l'etat de la PR**
   - Review independante OK postee apres le dernier commit (`<!-- review-4-axes -->` ou `<!-- review-rapide -->`, ou GREEN `/dw:review`)
   - Commentaires de la PR et de l'issue Linear traites (aucun bloquant sans commit ni reponse)
   - CI : `gh pr checks <pr>` vert, consulte apres le dernier push
   - Branche a jour avec la base (`mergeStateStatus` different de `BEHIND`), sans conflit

2. **Presenter le statut a l'utilisateur**
   ```
   PR #XX : [titre]
   - Review : [OK / manquante / perimee]
   - Retours ouverts : X
   - Checks CI : [pass / fail / pending]
   - A jour avec la base : [oui / non]
   ```

3. **Selon l'etat**
   - Points restants : les lister, et proposer de les traiter (`/dev-fix-review`, CI, merge de la base)
   - Tout est pret : commentaire Linear « PR #XX prete (review OK, retours traites, CI verte), en attente de merge », issue en `In Review` si elle n'y est pas deja, puis remettre la PR a l'humain avec son URL

4. **Apres un merge fait par l'humain** (sur demande)
   - Verifier `gh pr view <pr> --json state` = `MERGED`
   - Issue Linear : `Fixes <CLE>-XXXX` l'a normalement passee en `Done` ; sinon la passer en `Done` avec un commentaire (PR, merge commit)
   - Retour sur la base a jour (`git switch main && git pull --ff-only`), suppression de la branche locale proposee
