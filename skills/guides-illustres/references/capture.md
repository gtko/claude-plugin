# Capture headless : mise en place et pièges

## Structure du dossier

```
guides-capture/            (hors du dossier publié)
  README.md                ports, variables, commande par script
  .gitignore               .env.test, out/, .capture-data*/
  .env.test                identifiants générés (jamais affichés)
  mock-<données>.mjs       données factices + images servies par route() (ex. : mock-catalog.mjs)
  posters/                 images dont on a les droits (copie locale)
  example-<x>/server.mjs   exemples servis en local (extension, playlist…)
  capture-<guide>.mjs      un script par guide ou groupe de guides
  out/<slug>/img/NN-nom.webp, img/poster.webp, clip.mp4
```

## Démarrage (selon la stack ; exemple : app Vite + API locale)

- **API** : lancée par le script lui-même (`spawn`), port dédié, dossier de données neuf à chaque passage (`rmSync` puis variable d'env du projet). L'arrêter dans un `finally`.
- **Premier compte** : beaucoup d'API créent le premier compte sans invitation sur une base vierge. Sinon : se connecter d'abord, créer ensuite (une relance sur une base existante renvoie souvent 403 sur l'inscription).
- **Pointer l'app vers l'API locale sans toucher son code** : chercher où l'app lit l'URL de l'API (variable Vite, `localStorage`, config). Si c'est le `localStorage`, `context.addInitScript` qui pose la clé seulement si elle est absente.
- **App** : réutiliser un dev server s'il répond vraiment (tester une requête avec délai), sinon lancer un Vite privé (`npx vite --port 80xx`) et passer `CAPTURE_APP_URL`. Ajouter cette origine à la liste CORS de l'API (variable d'env de l'API, pas son code).
- **Garde réseau** : `context.route('**/*')` : local autorisé, mocks servis, tout le reste `abort()` et listé dans le rapport (polices Google, CDN d'images, YouTube…).

## Qualité visuelle

| Élément | Réglage |
| --- | --- |
| Viewport | 1280x800, `deviceScaleFactor: 2` pour les captures |
| Images | PNG → WebP qualité 82 (dégressive jusqu'à < 250 Ko), variante 1280 px qualité 80 |
| Vidéo | `recordVideo` 1280x800 → H.264 `-crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart -an`, ≤ 20 s, < 3 Mo |
| Lisibilité | curseur factice + onde au clic, souris lissée (8-18 pas), frappe 70 ms/caractère, pauses 400-800 ms |
| Montage | retirer le blanc du début et les temps de capture (trim + concat) |
| Partage | `og.jpg` 1200x630 recadré centré, JPEG `-q:v 5` (pas de WebP : certains réseaux ne l'affichent pas) |

Avant chaque capture : garer le curseur dans un coin (`mouse.move(2,2)`) pour éviter les états de survol, masquer le calque du curseur factice.

## Pièges

- **Re-rendu tardif** : la page se redessine une fois après chargement (données asynchrones, événement global) et efface la saisie ou retire un formulaire. Parade : `waitNetQuiet` (compteur de requêtes en vol), attendre un second rendu stable, relire `inputValue()` avant de valider, relance automatique d'une étape (une fois). Le signaler comme bug de l'app si l'utilisateur peut le subir.
- **Course au premier rendu** de l'accueil : attendre un sélecteur précis de l'état final, jamais un `sleep`.
- **Menu latéral scroll-spy** : après un `scrollIntoView`, c'est la section voisine qui est surlignée. Cliquer l'entrée du menu, puis attendre la fin du défilement (`waitScrollSettled`).
- **Éléments fixes** (bouton retour, barre de sauvegarde) au-dessus du contenu : défiler en haut de page, ou masquer l'élément par CSS injecté pour cette capture seulement.
- **Clic hors fenêtre** : `scrollIntoViewIfNeeded()` avant `boundingBox()`, sinon le clic part à des coordonnées négatives.
- **Contenu vide sans clé d'API tierce** (ex. : catalogue, Top 10) : mocker les routes avec des données plausibles. Les rendre **cohérentes avec le parcours** (ex. : un profil enfant 12 ans ne doit voir que des titres ≤ 12 ans, la mise en avant doit être familiale).
- **Lecture automatique** qui échoue faute de vrai média : désactiver la préférence correspondante dans le navigateur de test, ou servir une mire (`ffmpeg -f lavfi -i testsrc`).
- **Ce que l'app web refuse par principe** (ex. flux `http://` hors app native) : le montrer tel quel et l'expliquer dans le guide, ne pas modifier l'app pour la capture.
- **Parallélisme** : deux scripts sur la même API ou le même dossier de données se marchent dessus. Un port et un dossier par script, et un mock partagé en lecture seule (ou une copie).
- **Images supprimées du site** entre-temps : garder une copie locale dans `guides-capture/` plutôt que lire `public/`.
- **Instabilité** : exiger deux passages consécutifs réussis avant de considérer un script comme fini.
