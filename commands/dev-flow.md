---
description: "Orchestrateur complet : de la demande a la PR prete (issue Linear, branche, implementation, tests, PR, review, CI, retours), sans merge"
argument-hint: "Description de ce que tu veux realiser"
---

# Dev Flow

Demande : $ARGUMENTS

Charge le skill `livraison` (`gtko-agents:livraison` en mode plugin) avant toute modification de code et suis ses etapes 0 a 12 dans l'ordre ; il fait foi. Enchainement : `/linear-sync` → `/dev-branch` → `/dev-implement` → `/dev-commit` → `/dev-pr` (avec `/dev-review`) → `/dev-fix-review` jusqu'a PR prete.

- Ne redemande rien entre les etapes, sauf aux points d'arret de `livraison`.
- Seuls les agents du graphe gtko sont admis (`routing-guard` refuse les autres).
- Jamais de merge : la PR prete est remise a l'humain.
