---
description: "Review independante d'une PR ouverte par opus-advisor (4 axes), postee sur la PR"
argument-hint: "Numero de PR ou branche (optionnel, utilise la branche courante par defaut)"
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git fetch:*), Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh pr comment:*), Bash(gh api:*)
---

# Review de Pull Request

PR : $ARGUMENTS (defaut : PR de la branche courante) — skill `livraison`, etape 8. Jamais faite par l'agent qui a ecrit le code.

1. Contexte pour le brief : diff (`gh pr diff`), issue liee (`get_issue` + `list_comments` : criteres, besoin a jour), doc qui fait foi (`CONTRIBUTING.md`, `docs/`, ADR), commentaires deja postes (ne pas les dupliquer).
2. `opus-advisor` : review 4 axes (BUG, SECURITY, UX/UI, PERFORMANCE / COUT) au format `<!-- review-4-axes -->` de `agents/opus-advisor.md`, couverture des criteres, tests ni supprimes ni affaiblis, perimetre. Petit diff hors chemins sensibles : `sonnet-reviewer`, format `<!-- review-rapide -->` avec sa ligne `Tests :`. Second avis `fr-reviewer` si la PR touche donnees, paiement, autorisation ou concurrence.
3. Verifier chaque finding (`fichier:ligne` relu), puis poster la review sur la PR (`gh pr comment`).
4. `Verdict : A CORRIGER` : `haiku-builder` corrige (un commit par point), gate locale, push, recap « point → commit » sur la PR, nouvelle review des axes concernes, jusqu'a `Verdict : OK` poste apres le dernier commit.
