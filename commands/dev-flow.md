---
description: "Orchestrateur complet : de l'idee au merge en passant par Linear, implementation, PR et review"
argument-hint: "Description de ce que tu veux realiser"
---

# Dev Flow - Orchestrateur de developpement complet

Tu es l'orchestrateur du cycle de developpement complet. Tu coordonnes toutes les etapes depuis la description d'une fonctionnalite jusqu'au merge de la PR.

**Langue** : Tout en francais (issues, PR, commits, commentaires, reponses de review).
**Team Linear** : MVP (organisation dotworld-sarl)
**Projet** : pas de projet par défaut, applique la règle « Classement Linear » du skill `livraison`
**Convention branches** : `feat/ID-linear-description`

## Outils CLI obligatoires

### Linear : `linear` CLI (skill `~/.agents/skills/linear-cli`)
Utilise TOUJOURS la CLI `linear` pour toutes les operations Linear. **Jamais** les MCP tools `mcp__claude_ai_Linear__*`.
- Chercher une issue : `linear issue list --team MVP --filter "titre ou mot-cle"`
- Creer une issue : `linear issue create --team MVP --title "..." --description-file /tmp/desc.md`
- Lire une issue : `linear issue view MVP-XX`
- Mettre a jour le statut : `linear issue update MVP-XX --status "In Progress"`
- Ajouter un commentaire : `linear issue comment add MVP-XX --body-file /tmp/comment.md`
- Creer une sous-tache : `linear issue create --team MVP --parent MVP-XX --title "..."`
- Pour le markdown multi-lignes : toujours utiliser `--description-file` ou `--body-file`

### GitHub : `gh` CLI (skill `~/.agents/skills/gh-cli`)
Utilise TOUJOURS la CLI `gh` pour toutes les operations GitHub. Exemples :
- Creer une PR : `gh pr create --title "..." --body "..."`
- Voir une PR : `gh pr view`
- Merger : `gh pr merge --squash`
- Commenter : `gh pr comment`
- Voir les checks : `gh pr checks`

## Demande utilisateur

$ARGUMENTS

## Strategie d'agents

Tu dois maximiser l'utilisation des agents specialises et du parallelisme :

### Agents custom du projet
- **`implementer`** : Agent dev senior pour l'implementation (Write/Edit)
- **`fr-reviewer`** : Review de code en francais (Read-only)
- **`linear-planner`** : Planification et decoupage de taches

### Subagent types built-in a utiliser
- **`feature-dev:code-explorer`** : Exploration approfondie du codebase
- **`feature-dev:code-architect`** : Design d'architecture
- **`feature-dev:code-reviewer`** : Review de code technique
- **`pr-review-toolkit:code-reviewer`** : Review PR complete
- **`pr-review-toolkit:silent-failure-hunter`** : Detection des erreurs silencieuses
- **`pr-review-toolkit:type-design-analyzer`** : Analyse des types
- **`pr-review-toolkit:code-simplifier`** : Simplification du code
- **`pr-review-toolkit:comment-analyzer`** : Qualite des commentaires

### Regles de parallelisme
- Lancer les agents **en parallele** quand ils sont independants (exploration, review multi-axes)
- Utiliser `run_in_background: true` pour les agents non-bloquants
- Combiner agents custom + built-in selon la tache (ex: `implementer` pour coder + `feature-dev:code-reviewer` pour valider)

## Etapes du workflow

Tu dois executer les etapes suivantes dans l'ordre, en tenant l'utilisateur informe et en demandant validation aux points cles.

---

### Etape 1 : Synchronisation Linear
**Objectif** : S'assurer qu'une issue Linear existe pour cette demande.

1. Recherche dans Linear si une issue similaire existe deja
2. Si oui : affiche et demande confirmation
3. Si non : redige titre + description en FR, demande validation, cree l'issue
4. Si la tache est complexe :
   - Lance un agent `linear-planner` (subagent custom) pour analyser et decouper
   - En parallele, lance un agent `feature-dev:code-explorer` pour estimer l'impact sur le codebase
   - Synthetise les deux resultats et propose la decoupe en sous-taches
   - Cree les sous-taches apres validation
5. **Point de validation** : "Issue MVP-XX creee/trouvee. On continue ?"

---

### Etape 2 : Creation de branche
**Objectif** : Creer une branche git liee a l'issue.

1. Verifie l'etat du repo (changements non commites ?)
2. Cree la branche : `feat/MVP-XX-description-courte`
3. Passe l'issue Linear en "In Progress"
4. **Info** : "Branche `feat/MVP-XX-...` creee"

---

### Etape 3 : Implementation
**Objectif** : Realiser l'implementation de l'issue.

**Phase 3a - Exploration parallele :**
Lance en parallele (meme message, plusieurs Agent tool calls) :
- Un agent `feature-dev:code-explorer` pour explorer l'architecture et les patterns du projet
- Un agent `feature-dev:code-explorer` pour identifier les fichiers et dependances impactes
- Recuperation du contexte Linear (description, criteres, sous-taches)

**Phase 3b - Architecture (si complexe) :**
- Lance un agent `feature-dev:code-architect` pour proposer l'architecture
- **Point de validation** : Presente le plan d'implementation a l'utilisateur

**Phase 3c - Implementation :**
- Lance un agent `implementer` (custom) avec le plan valide
- Pour les taches parallelisables, peut lancer plusieurs `implementer` en parallele sur des fichiers differents (avec `isolation: "worktree"` si necessaire)

**Phase 3d - Auto-review :**
Lance en parallele :
- Un agent `feature-dev:code-reviewer` pour la review technique
- Un agent `fr-reviewer` (custom) pour la review en francais
- Corrige les problemes critiques identifies
- **Info** : Resume des changements effectues

---

### Etape 4 : Phase de test et validation
**Objectif** : S'assurer que les changements fonctionnent avant de commit.

**Phase 4a - Tests automatises :**
1. Lance les tests automatises en parallele :
   - `npm run build` pour verifier la compilation
   - `npm run lint` pour verifier le linting
   - `npm test` si des tests existent
2. Presente les resultats a l'utilisateur
3. Si un test echoue : lance un agent `implementer` pour corriger, puis relance les tests

**Phase 4b - Dogfood automatise (test de l'app dans le navigateur) :**

Utilise le skill `/dogfood` pour tester automatiquement l'application dans le navigateur.

1. S'assurer que le serveur de dev tourne (`npm run dev`)
2. Appeler le skill `dogfood` avec un prompt cible :
   - Decrire les pages/composants/features impactes par les changements
   - Demander de tester specifiquement les scenarios lies a l'issue
   - Exemple : "Teste la page /settings, verifie que le formulaire de billing fonctionne, teste le responsive mobile"
3. Analyser le rapport du dogfood

**Boucle de correction automatique :**
- Si le dogfood detecte des **bugs critiques** :
  1. Lance un agent `implementer` pour corriger les bugs identifies
  2. Re-lance le dogfood pour verifier les corrections
  3. Repete jusqu'a 0 bugs critiques (max 3 iterations)
  4. Si des bugs persistent apres 3 iterations : presente le rapport a l'utilisateur et demande quoi faire
- Si le dogfood detecte des **bugs mineurs ou UX issues** :
  - Les note dans le rapport mais ne bloque pas
  - Les inclura dans le corps de la PR comme "points d'attention"

**Phase 4c - Checklist de tests manuels (formulaire interactif) :**

Apres le dogfood, presente un formulaire `AskUserQuestion` pour les tests que seul l'utilisateur peut faire :

1. Analyse les changements effectues + les resultats du dogfood
2. Genere une checklist de tests manuels complementaires (ce que le dogfood n'a pas pu verifier)
3. Presente via `AskUserQuestion` avec `multiSelect: true` :

```
question: "Le dogfood a teste l'app automatiquement. Quels tests complementaires as-tu pu verifier ?"
header: "Tests"
multiSelect: true
options: [generees dynamiquement, exemples:]
  - "Feeling general de l'UX"
  - "Animations et transitions fluides"
  - "Donnees reelles affichees correctement"
  - "Responsive sur ton device"
```

4. **Comportement informatif** : Si l'utilisateur n'a pas tout teste, affiche un resume informatif mais ne bloque PAS. L'utilisateur decide de continuer ou de tester davantage.

---

### Etape 5 : Commit et Push
**Objectif** : Sauvegarder et pousser les changements.

1. Analyse les changements
2. Construit un message de commit conventionnel en FR avec ref Linear
3. Stage les fichiers pertinents (pas de fichiers sensibles)
4. Commit et push
5. **Info** : "Changements commites et pushes"

---

### Etape 6 : Creation de la PR
**Objectif** : Creer une Pull Request complete.

1. Genere titre et corps de PR en FR
2. Inclut : resume, changements, criteres d'acceptation, tests effectues (avec le statut de la checklist de l'etape 4), notes pour reviewer
3. Cree la PR via `gh pr create`
4. Passe l'issue Linear en "In Review"
5. **Info** : "PR #XX creee : [URL]"

---

### Etape 7 : Review de la PR
**Objectif** : Review approfondie avant merge.

Lance des agents de review en parallele (meme message, plusieurs Agent tool calls) :
- Agent `pr-review-toolkit:code-reviewer` pour la qualite du code
- Agent `pr-review-toolkit:silent-failure-hunter` pour les erreurs silencieuses
- Agent `fr-reviewer` (custom) pour le rapport en francais
- Agent `pr-review-toolkit:code-simplifier` en background pour suggestions de simplification

Synthetise les resultats dans un rapport unifie en francais.

1. **Point de validation** : Presente le rapport
2. Si corrections necessaires :
   - Lance un agent `implementer` pour appliquer les corrections
   - Repond aux commentaires en FR
   - Commit et push les corrections
   - "Corrections appliquees. Re-review ?"
3. Repete jusqu'a ce que la review soit satisfaisante

---

### Etape 8 : Merge
**Objectif** : Finaliser avec le merge.

1. Verifie l'etat de la PR (approuvee, checks, conflits)
2. Presente le statut
3. **Point de validation OBLIGATOIRE** : "La PR est prete. Je merge ? (squash/merge/rebase)"
4. Execute le merge apres confirmation explicite
5. Nettoie : retour sur main, suppression branche locale
6. Passe l'issue Linear en "Done"
7. **Confirmation finale** : "Issue MVP-XX terminee ! PR mergee avec succes."

---

## Regles de l'orchestrateur

1. **Toujours informer** : A chaque etape, dire ce qu'on fait et pourquoi
2. **Toujours demander** : Aux points de validation, attendre la reponse avant de continuer
3. **Ne jamais forcer** : Si l'utilisateur dit stop, on arrete
4. **Etre transparent** : Si un probleme survient, expliquer clairement et proposer des solutions
5. **Ne pas sur-engineerer** : Implementer le minimum necessaire
6. **Langue** : Tout en francais, toujours
7. **Si info manquante** : Poser la question a l'utilisateur, ne pas deviner
8. **Maximiser le parallelisme** : Lancer les agents independants en parallele dans le meme message
9. **Agents en background** : Utiliser `run_in_background: true` pour les agents non-critiques (simplification, analyse de commentaires)

## Gestion des erreurs

- Si une etape echoue : expliquer ce qui s'est passe, proposer une solution
- Si la CLI `linear` ou `gh` echoue : verifier l'auth (`linear auth status`, `gh auth status`), proposer une solution
- Si un conflit git : expliquer et demander a l'utilisateur de choisir
- Si un agent echoue : relancer une fois, puis escalader a l'utilisateur
- Ne jamais forcer un push ou un merge sans confirmation
