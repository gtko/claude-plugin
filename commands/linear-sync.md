---
description: "Synchronisation Linear : chercher/creer une issue, planifier, decouper en sous-taches"
argument-hint: "Description de la fonctionnalite ou de la tache"
---

# Synchronisation Linear

Tu geres la synchronisation avec Linear pour la team **MVP** de l'organisation **dotworld-sarl**.
Pas de projet par défaut : applique la règle « Classement Linear » du skill `livraison`.

Toutes les communications (titres, descriptions, commentaires) sont en **francais**.

## Contexte

Demande utilisateur : $ARGUMENTS

## Phase 1 : Recherche d'issue existante

**Actions :**
1. Utilise ``linear team list`` pour recuperer la team **MVP**
2. Utilise ``linear issue list --team MVP`` pour chercher si une issue similaire existe deja dans la team
3. Si une issue existe :
   - Affiche-la a l'utilisateur avec son statut, son identifiant et sa description
   - Demande confirmation : "C'est bien cette issue ? Ou je dois en creer une nouvelle ?"
4. Si aucune issue ne correspond :
   - Informe l'utilisateur qu'aucune issue n'a ete trouvee
   - Passe a la Phase 2

## Phase 2 : Creation de l'issue

**Actions :**
1. Redige un titre clair et concis en francais
2. Redige une description structuree en francais avec :
   - **Contexte** : pourquoi cette tache
   - **Objectif** : ce qu'on veut accomplir
   - **Criteres d'acceptation** : liste des conditions de validation
3. Presente le brouillon a l'utilisateur pour validation
4. Utilise ``linear issue create` ou `linear issue update`` pour creer l'issue dans la team MVP
5. Affiche l'identifiant de l'issue creee (ex: MVP-42)

## Phase 3 : Planification et decoupe

**Actions :**
1. Analyse la complexite de la tache
2. Si la tache est simple (estimee < 2h de dev) :
   - Ajoute un plan d'implementation dans la description de l'issue
   - Informe l'utilisateur : "Tache simple, pas besoin de sous-taches"
3. Si la tache est complexe :
   - Propose une decoupe en sous-taches (3-7 sous-taches max)
   - Chaque sous-tache avec : titre, description courte, estimation relative
   - Demande validation a l'utilisateur
   - Cree les sous-taches avec ``linear issue create` ou `linear issue update`` en les liant a l'issue parente
4. Met a jour l'issue parente avec le plan via ``linear issue create` ou `linear issue update``

## Phase 4 : Confirmation

**Actions :**
1. Affiche un recapitulatif :
   - Issue principale : ID + titre
   - Sous-taches (si applicable) : IDs + titres
   - Statut : prete pour implementation
2. Retourne l'identifiant de l'issue principale pour les etapes suivantes

## Notes importantes

- Toujours demander confirmation avant de creer quoi que ce soit
- Si l'utilisateur corrige un titre ou une description, appliquer immediatement
- Utiliser les labels existants du projet quand c'est pertinent
- Estimer la priorite en fonction de la description (urgent, haute, moyenne, basse)
