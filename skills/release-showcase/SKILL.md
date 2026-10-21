---
name: release-showcase
description: Produit une release GitHub soignée (bannière, illustrations, notes rédigées) via gh release edit. Pour « fais une jolie release », « release notes avec bannière », ou après un tag.
---

# Release showcase

Transforme une release brute (tag, commits, PR, CHANGELOG) en page de release lisible : bannière, 3 à 5 points forts illustrés, notes soignées.

Skill en trois parties : `scripts/render.cjs` (HTML vers PNG), `templates/` (bannière et carte, paramétrables), `scripts/notes-template.md` (squelette des notes).

## Prérequis

- `gh` authentifié sur le repo, `git` propre, branche par défaut à jour.
- Chrome installé (sinon `CHROME_PATH=/chemin/vers/chrome`). `playwright-core` se résout seul (voir l'en-tête de `render.cjs`).
- Ne jamais toucher aux assets existants de la release, ni déplacer ou recréer le tag.

## Étapes

1. **Collecter.** Tag cible `T`, précédent `P=$(git describe --tags --abbrev=0 "T^" 2>/dev/null)`. S'il n'y a pas de précédent (première release), prendre le premier commit : `git rev-list --max-parents=0 HEAD`.
   - Commits : `git log P..T --oneline`.
   - PR fusionnées : `gh pr list --state merged --search "merged:>=AAAA-MM-JJ" --limit 200 --json number,title,url,author`, où la date est celle du précédent tag.
   - Section du CHANGELOG pour `T` (ou `Unreleased` si pas encore renommée), et notes actuelles : `gh release view T`.

2. **Choisir 3 à 5 points forts**, orientés utilisateur : ce que la personne peut faire ou voit désormais, pas le nom des commits. Le reste va dans Added, Changed, Fixed, Security, tiré du CHANGELOG.

3. **Illustrer.**
   - Bannière : `templates/banner.html`, rendue en `1280 640 2`. Paramètres dans l'en-tête du gabarit (project, version, tagline, bullets, url, image, accent).
   - Un visuel par point fort, dans `templates/card.html` (1200 x 675, rendu en `1200 675 2`) :
     - `visual=image` si une capture existante montre la fonctionnalité. Chercher dans `docs/`, `docs/screenshots/`, `assets/`, `git ls-files '*.png' '*.webp' '*.jpg'`. Vérifier qu'elle ne contient ni données réelles ni art tiers.
     - sinon `visual=lanes` (file de tâches), `visual=steps` (liste numérotée) ou `visual=shield` (contrôles cochés).
   - Exemple :
     ```sh
     node ~/.claude/skills/release-showcase/scripts/render.cjs ~/.claude/skills/release-showcase/templates/card.html out/card-01.png 1200 675 2 \
       --data '{"index":"01","kicker":"Living wallpaper","title":"…","body":"…","tags":["…"],"visual":"image","image":"docs/screenshots/dojo.webp"}'
     ```
   - Les chemins d'image relatifs sont résolus depuis le répertoire courant. `--data @fichier.json` évite les problèmes de guillemets.
   - Réduire au format final avec Lanczos (sinon `sips -z <h> <l>`). Bannière : `magick in.png -filter Lanczos -resize 1280x640 -strip -quality 92 -sampling-factor 4:4:4 banner.jpg` (JPEG q 92, compatible Open Graph, environ 120 Ko ; le PNG brut dépasse souvent 600 Ko à cause du grain). Illustrations : `magick in.png -filter Lanczos -resize 1200x675 -strip card.png && cwebp -quiet -q 90 card.png -o card.webp`.
   - **Lire chaque image** (outil Read, sur une copie PNG si besoin) et itérer : texte net, rien de coupé, contraste correct. Au plus 10 itérations par image. Une planche de contrôle (`magick montage`) suffit pour voir l'ensemble.
   - Poids : moins de 600 Ko par image.

4. **Déposer** dans `docs/releases/<tag>/` sur la branche par défaut : `git add docs/releases/<tag>`, commit `docs(release): illustrations de la <tag>`, `git pull --rebase`, `git push`. Ne rien ajouter d'autre. Si le repo a un scan de termes personnels en CI, le lancer sur les fichiers ajoutés.

5. **Rédiger les notes** avec `scripts/notes-template.md`, dans la langue du README du projet. Le fichier vit hors du repo (scratchpad). Ordre : bannière, accroche de 1 à 2 phrases, `Highlights` (image + 2 à 3 lignes par point fort), Added / Changed / Fixed / Security (sections vides omises), Installation (fichiers, `shasum -a 256 -c`, première ouverture si l'app n'est pas notarisée), lien Full changelog, Crédits. Toutes les images en URL absolue `https://raw.githubusercontent.com/<owner>/<repo>/<branche>/docs/releases/<tag>/<fichier>`.

6. **Appliquer** : `gh release edit <tag> --title "<projet> <tag> — <accroche courte>" --notes-file <fichier>`. Ne pas modifier les assets ni le statut draft ou prerelease.

7. **Vérifier.**
   - `gh release view <tag> --json name,body,assets` : titre et notes à jour, assets toujours présents.
   - Pour chaque URL d'image : `curl -s -o /dev/null -w '%{http_code}' <url>` doit renvoyer 200. Le CDN peut mettre quelques minutes à voir un push récent.
   - Relire le rendu Markdown.

## Règles

- Langue : celle du README. Pas de données personnelles (noms, e-mails, chemins locaux, tokens) dans les images ni les notes.
- Un point fort, une image. Cinq au maximum.
- Rien d'inventé : chaque affirmation des notes doit correspondre au code, au CHANGELOG ou aux PR.
- Pas de fichier de rapport en plus dans le repo : les notes vont dans `gh release edit`.

## Sortie attendue

URL de la release, chemins des PNG de contrôle, résultat des vérifications (codes HTTP, `gh release view`).
