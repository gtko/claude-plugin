---
description: "Issue Linear de la demande : reprendre une issue existante (pas de doublon) ou la creer avec ses criteres en checklist, puis decouper si besoin"
argument-hint: "Description de la fonctionnalite ou de la tache"
---

# Synchronisation Linear

Demande : $ARGUMENTS — skill `livraison`, etape 2 et « Classement Linear ».

1. **Doublons d'abord** : `list_issues` (equipe nommee par la doc du depot, sinon demander) sur plusieurs mots-cles et sur les identifiants cites, puis `get_issue` + `list_comments` des candidates. Issue au meme perimetre : la reprendre ; criteres absents : ajouter une section `## Criteres d'acceptation` en checklist s'ils se deduisent, et le dire en commentaire. Ligne `Criteres a preciser :` : demander.
2. **Sinon creer** (`save_issue`, sans redemander si la demande est claire) : contexte 1 a 3 phrases, `## A faire`, `## Criteres d'acceptation` en `- [ ] ...` (jamais inventes), `## Hors perimetre`. Labels existants seulement, jamais de label cree ; priorite et projet seulement s'ils sont demandes.
3. **Decoupe** si la tache depasse ~2h : `linear-planner` propose 3 a 7 sous-issues testables, validees par l'utilisateur avant creation.
4. Rendre l'identifiant ; suite : `/dev-branch`.
