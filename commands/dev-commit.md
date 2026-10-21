---
description: "Commit et push des changements lies a une issue"
argument-hint: "Identifiant de l'issue Linear (ex: MVP-42) ou message de commit"
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git push:*), Bash(git diff:*), Bash(git log:*), Bash(npm run build:*), Bash(npm run lint:*), Bash(npm test:*), AskUserQuestion
---

# Commit et Push

Commit et push les changements en cours, lies a l'issue Linear.
**Inclut une phase de test interactive avant le commit.**

## Contexte

- Argument : $ARGUMENTS
- Branche actuelle : !`git branch --show-current`
- Statut git : !`git status`
- Diff : !`git diff HEAD --stat`

## Workflow

### 1. Analyser les changements
- Examiner les fichiers modifies/ajoutes/supprimes
- Verifier qu'aucun fichier sensible n'est inclus (.env, credentials, etc.)
- Grouper les changements par theme si necessaire

### 2. Tests automatises
Lance en parallele :
- `npm run build` pour verifier la compilation
- `npm run lint` pour le linting

Si des tests existent, lance aussi `npm test`.

Presente les resultats. Si un test echoue, informe l'utilisateur et propose de corriger avant de continuer.

### 3. Dogfood automatise (test dans le navigateur)

Utilise le skill `/dogfood` pour tester l'app automatiquement dans Chrome.

**Etapes :**
1. S'assurer que le serveur de dev tourne (`npm run dev`)
2. Appeler le skill `dogfood` en ciblant les pages/composants impactes par les changements
3. Analyser le rapport

**Boucle de correction :**
- Si bugs critiques detectes :
  1. Lance un agent `implementer` pour corriger
  2. Re-lance le dogfood
  3. Max 3 iterations, puis escalade a l'utilisateur
- Bugs mineurs/UX : notes pour la PR, pas de blocage

### 4. Phase de test interactive (formulaire)

Apres le dogfood, utilise `AskUserQuestion` pour les tests complementaires manuels.

**Comment generer la checklist :**
1. Analyse les fichiers modifies (`git diff --name-only HEAD`)
2. Identifie ce que le dogfood n'a pas pu verifier (UX feeling, donnees reelles, device specifique)
3. Genere 2-4 items de test pertinents

**Appel AskUserQuestion :**
```
question: "Le dogfood a teste l'app. Quels tests complementaires as-tu verifies ?"
header: "Tests"
multiSelect: true
options: [generees dynamiquement, exemples:]
  - label: "Feeling general de l'UX"
    description: "L'experience utilisateur est fluide et naturelle"
  - label: "Donnees reelles OK"
    description: "Les vraies donnees s'affichent correctement"
  - label: "Responsive sur ton device"
    description: "Teste sur ton telephone/tablette"
  - label: "Pas de regression"
    description: "Navigation generale, pas de casse visible"
```

**Apres la reponse :**
- Si tout coche : "Parfait, on commit !"
- Si certains non coches : resume informatif, **ne bloque PAS**. "Tu veux continuer quand meme ou tester d'abord ?"
- Inclure le statut des tests (dogfood + manuels) dans le corps de la PR

### 5. Construire le message de commit
- Format : Conventional Commits en francais
- Structure :
  ```
  type(scope): description courte

  Description detaillee si necessaire.

  Ref: MVP-XX
  Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
  ```
- Types : feat, fix, refactor, chore, docs, test, style
- Toujours inclure la reference a l'issue Linear

### 6. Stage et commit
- `git add` des fichiers pertinents (pas de `git add .` aveugle)
- Creer le commit avec le message construit
- Verifier que le commit a reussi

### 7. Push
- `git push origin <branche>` (avec `-u` si premiere fois)
- Verifier que le push a reussi

### 8. Mettre a jour Linear
- Ajouter un commentaire sur l'issue avec le resume des changements
- Si tous les criteres d'acceptation sont remplis, mettre a jour le statut

## Notes

- Si les changements sont trop importants pour un seul commit, proposer un decoupage
- Ne jamais forcer le push (--force) sans demander explicitement
- Si un hook pre-commit echoue, corriger et refaire un nouveau commit
- La phase de test est informative, pas bloquante - l'utilisateur decide toujours
