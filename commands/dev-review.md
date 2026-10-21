---
description: "Review independante d'une Pull Request par des sous-agents (4 axes), rapport en francais poste sur la PR"
argument-hint: "Numero de PR ou branche (optionnel, utilise la branche courante par defaut)"
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git status:*), Bash(git branch:*), Bash(git fetch:*), Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh pr comment:*), Bash(gh api:*)
---

# Review de Pull Request

Review independante de la PR ouverte (skill `livraison`, etape 8) : elle est faite par des **sous-agents du graphe**, jamais par l'agent qui a ecrit le code.

## Contexte

- Argument : $ARGUMENTS
- Branche actuelle : !`git branch --show-current`
- PR en cours : !`gh pr view --json number,title,url,body 2>/dev/null || echo "Pas de PR trouvee"`

## Phase 1 : Collecte du contexte

1. Recuperer la PR (depuis l'argument ou la branche courante), son diff (`gh pr diff`) et ses fichiers
2. Issue Linear liee (identifiant dans le titre, le corps ou la branche) : connecteur MCP `get_issue` et `list_comments`, pour les criteres d'acceptation et le besoin a jour
3. Doc du depot qui fait foi : `CONTRIBUTING.md`, `CLAUDE.md`, `docs/` (regles metier, ADR)
4. Reviews et commentaires deja postes (`gh pr view --comments`, `gh api repos/{owner}/{repo}/pulls/{pr}/comments`) : ne pas dupliquer un finding existant

## Phase 2 : Review par sous-agents (en parallele)

Seuls les agents du graphe sont admis (le hook routing-guard refuse les agents d'autres plugins). Lance dans le meme message :

### Agent 1 : `opus-advisor` (relecteur independant, obligatoire)
- Prompt : "Review 4 axes (BUG, SECURITY, UX/UI, PERFORMANCE / COUT) de la PR [numero] : diff [chemin ou commande], issue [criteres d'acceptation], doc qui fait foi [chemins]. Verifie aussi la couverture des criteres, les tests (ni supprimes ni affaiblis, nouveaux tests qui echoueraient si le code etait casse) et le perimetre. Format <!-- review-4-axes -->."

### Agent 2 : `fr-reviewer` (second avis, si la PR touche un risque central : donnees, paiement, autorisation, concurrence)
- Prompt : "Review en francais des fichiers modifies : [liste]. Rapport avec scoring de confiance. Focus : coherence architecturale, patterns, maintenabilite."

### Voie rapide (petit diff hors chemins sensibles)
- `sonnet-reviewer` a la place d'opus-advisor, format `<!-- review-rapide -->` avec sa ligne `Tests :`

## Phase 3 : Synthese et post

Combine les rapports, verifie chaque finding (`fichier:ligne` relu) et elimine les doublons, puis poste le resultat sur la PR (`gh pr comment`), au format `<!-- review-4-axes -->` d'opus-advisor :

```markdown
<!-- review-4-axes -->
## Review 4 axes
### BUG
...
### SECURITY
...
### UX/UI
...
### PERFORMANCE / COUT
...
Verdict : OK | A CORRIGER
```

## Phase 4 : Action

1. Presenter le rapport a l'utilisateur
2. `Verdict : A CORRIGER` : faire corriger chaque point (agent `haiku-builder`, un commit par correctif), gate locale, push, puis nouvelle review sur les axes concernes, jusqu'a `Verdict : OK` poste apres le dernier commit
3. Retours d'autres relecteurs : `/dev-fix-review`
