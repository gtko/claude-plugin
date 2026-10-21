---
description: "Creer une branche git liee a une issue Linear et passer l'issue In Progress"
argument-hint: "Identifiant de l'issue Linear (ex: MVP-42)"
allowed-tools: Bash(git checkout:*), Bash(git switch:*), Bash(git branch:*), Bash(git fetch:*), Bash(git status:*), Bash(git show:*)
---

# Creation de branche

Cree une branche git liee a une issue Linear (skill `livraison`, etape 3).

## Contexte

- Issue Linear : $ARGUMENTS
- Branche actuelle : !`git branch --show-current`
- Statut git : !`git status --short`

## Convention de nommage

Dans cet ordre, la premiere qui existe :

1. la convention de la doc du depot (`CONTRIBUTING.md`, `CLAUDE.md`, `README.md`), par exemple `<ID>-<slug>` ;
2. le defaut : `feature/<cle>-xxxx-<slug>` (ex. `feature/mvp-42-ajout-systeme-auth`).

L'identifiant de l'issue figure toujours dans le nom : Linear lie la branche a l'issue, et le hook process-gate refuse un commit sans lui. Prefixe de type (`feat`, `fix`, `refactor`, `chore`, `docs`…) si la convention du depot en prevoit un.

## Workflow

1. **Verifier l'etat du repo**
   - S'assurer qu'il n'y a pas de changements non commites
   - Si changements en cours, demander a l'utilisateur quoi faire (commit sur une autre branche, abandon) ; jamais de perte silencieuse

2. **Recuperer l'info de l'issue**
   - Connecteur MCP Linear `get_issue` (et `list_comments`) pour le titre, le statut et les criteres
   - Issue d'une autre equipe que celle du depot, ou branche / PR deja existante pour cette issue : montrer l'etat et demander

3. **Creer la branche depuis la base distante fraiche**
   - `git fetch origin --prune`
   - `git switch -c <nom-branche> refs/remotes/origin/<base>` (base : celle de la doc du depot, sinon `main`)

4. **Mettre a jour Linear**
   - Passer l'issue en `In Progress` (`save_issue`), avant toute modification de code
   - Commentaire (`save_comment`) : « Branche creee : `<nom-branche>` »

5. **Confirmation**
   - Affiche : « Branche `<nom-branche>` creee et liee a l'issue $ARGUMENTS (In Progress) »
