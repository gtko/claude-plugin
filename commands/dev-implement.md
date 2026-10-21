---
description: "Implementer une issue avec les agents du graphe gtko"
argument-hint: "Identifiant de l'issue Linear (ex: MVP-42)"
---

# Implementation d'une issue

Issue : $ARGUMENTS — skill `livraison`, etapes 1 a 6. Prerequis : issue `In Progress` et branche qui porte son identifiant (sinon `/dev-branch`).

1. `get_issue` + `list_comments` : criteres d'acceptation et besoin a jour.
2. `haiku-scout` (en parallele si plusieurs zones) : patterns, regles du depot, chemins geles, doc qui fait foi ; synthese en ~10 lignes.
3. `opus-advisor` fixe le plan si une decision est a prendre ; validation utilisateur seulement pour une decision d'architecture majeure.
4. Builders selon le graphe (`haiku-builder` par defaut, `sonnet-builder` `DIRECT:`/`ESCALADE:`, `opus-builder` `OPUS:`), un worktree par lot parallele. Brief : criteres, regles du depot, test de regression rouge d'abord sur un bug, aucun test affaibli, critere de reussite (tests et lint verts).
5. `HORS PERIMETRE:` remonte par un builder : issue separee, pas de correction ici.
6. Suite : `/dev-commit`, puis `/dev-pr`. La review qui fait foi se fait sur la PR.
