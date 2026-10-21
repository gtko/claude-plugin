---
description: "Creer une Pull Request liee a une issue Linear (Fixes <ID>, plan de test), puis suivre la CI"
argument-hint: "Identifiant de l'issue Linear (ex: MVP-42)"
allowed-tools: Bash(git status:*), Bash(git log:*), Bash(git diff:*), Bash(git branch:*), Bash(git fetch:*), Bash(git push:*), Bash(gh pr create:*), Bash(gh pr view:*), Bash(gh pr checks:*), Bash(gh pr comment:*), Bash(gh run view:*), Bash(gh run rerun:*)
---

# Creation de Pull Request

Cree une Pull Request GitHub liee a l'issue Linear, puis la fait relire (skill `livraison`, etapes 6 a 9).

## Contexte

- Issue : $ARGUMENTS
- Branche actuelle : !`git branch --show-current`
- Commits depuis la base (`git.base` du contrat, sinon `main`) : !`git log refs/remotes/origin/main..HEAD --oneline 2>/dev/null || git log refs/remotes/origin/master..HEAD --oneline 2>/dev/null`

## Workflow

1. **Verifier les prerequis** (sinon, stop et le dire)
   - Tous les changements sont commites
   - Gate locale verte, mesuree sur ce head : tests ET lint (et build ou `commands.check` du contrat)
   - Branche a jour avec la base (`git fetch origin` ; sinon merge de la base, gate, puis reprise)
   - Aucune PR n'existe deja pour cette branche

2. **Recuperer le contexte Linear**
   - Connecteur MCP Linear `get_issue` et `list_comments` : titre, description, criteres d'acceptation, commentaires recents

3. **Construire la PR**
   - Titre : `<type>(domaine): description (<CLE>-XXXX)`
   - Corps en francais, ecrit dans un fichier :
     ```markdown
     Fixes <CLE>-XXXX

     ## Resume
     <ce qui a ete fait, 2-5 puces>

     ## Diagnostic
     <bug : cause constatee ; sinon retirer la section>

     ## Fix
     <fichiers et modules modifies, et pourquoi>

     ## Plan de test
     | Verification | Resultat |
     | --- | --- |
     | <commande ou scenario> | <resultat mesure> |

     <criteres d'acceptation coches, ce qui n'a pas pu etre verifie et pourquoi, issues hors perimetre ouvertes>
     ```
   - `Fixes <CLE>-XXXX` en premiere ligne (ou `Closes` / `Resolves` si la doc du depot l'impose) ; le corps se termine par la ligne d'attribution que la session prescrit

4. **Pousser et creer la PR**
   - `git push -u origin <branche>`
   - `gh pr create --base <base> --title "..." --body-file <fichier>` ; ne pas assigner de reviewers sauf demande
   - La PR n'est pas encore declaree prete

5. **Mettre a jour Linear**
   - Commentaire sur l'issue avec le lien de la PR

5 bis. **Review independante sur la PR**
   - `/dev-review` : `opus-advisor` (ou `sonnet-reviewer` en voie rapide) relit la PR, l'orchestrateur poste la review sur la PR, correctifs et re-review jusqu'a `Verdict : OK` poste apres le dernier commit

6. **CI et retours**
   - `gh pr checks <pr> --watch` apres ce push ; echec d'infra -> `gh run rerun <id> --failed` sans toucher au code
   - Lire les commentaires de la PR et de l'issue Linear, puis les traiter avec `/dev-fix-review`
   - PR prete (review OK, CI verte, retours traites) : commentaire Linear « PR prete, en attente de merge » et issue en `In Review` si elle n'y est pas deja. Jamais de merge.

7. **Confirmation**
   - URL de la PR, etat de la CI mesure, retours restants
