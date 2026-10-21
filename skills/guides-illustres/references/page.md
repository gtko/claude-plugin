# Page de guide : gabarit et check-list

Conventions de l'exemple (site statique, `public/guides/`, `guides.css`, `sitemap.xml`, liens `/#ancre`) : les adapter à la structure du site cible.

Partir de la page d'accueil du site : même head (polices locales, favicons, canonical, og/twitter), même en-tête et pied de page (liens d'ancre en `/#ancre`), une feuille `guides.css` en plus de la feuille du site, réutilisant ses variables (déclarer celles qui manquent dans `:root` plutôt que des couleurs en dur).

## Structure d'un guide

1. Fil d'Ariane `nav.guide-crumbs` (Guides › Titre, `aria-current="page"`) + JSON-LD `BreadcrumbList`.
2. En-tête : `h1`, chapô d'une phrase (le bénéfice), badges durée et plateformes (mêmes mots que l'accueil du site).
3. Vidéo du parcours : `<video class="clip" src="./clip.mp4" poster="./img/poster.webp" width height controls autoplay muted loop playsinline preload="metadata">`.
4. Prérequis (facultatif).
5. Étapes `ol.guide-steps` : une phrase d'action par étape, libellés de l'app entre « », figure si l'écran change.
   `<img src="./img/NN-nom-1280.webp" srcset="./img/NN-nom-1280.webp 1280w, ./img/NN-nom.webp 2560w" sizes="(max-width: 860px) 100vw, 820px" width height loading="lazy" alt="…">` (pas de `lazy` sur la première figure).
6. « Bon à savoir » (`aside`), puis sections spécifiques (exemple de code, format attendu, tableau des limites, « Si ça ne marche pas » avec les messages exacts de l'app).
7. Pager précédent / suivant ; le dernier guide renvoie au sommaire.
8. Script de pied de page : si `prefers-reduced-motion`, retirer `autoplay`, mettre en pause, `preload="none"`.
9. Mention légale si les captures utilisent un catalogue factice (« titres fictifs, affiches générées par IA »).

Emplacements en attente : `figure.shot.shot--todo` (ratio 16/10, « Capture à venir »), jamais d'image cassée.

## Alt et texte

- L'alt décrit ce qu'on voit, avec le libellé de l'écran (« Formulaire « Nouveau profil » rempli : nom Léo, couleur turquoise, avatar sélectionné »).
- Ne jamais affirmer ce que l'image ne montre pas (onglet actif, catégorie, emplacement d'un bouton).
- Typographie française : espace insécable avant `: ; ? !` et dans `« »`, y compris dans les attributs (meta, alt). Apostrophe droite dans le texte rédactionnel ; les libellés recopiés de l'app gardent leur forme exacte.

## Check-list avant publication

- [ ] URL ajoutée au `sitemap.xml` ; carte du sommaire passée de « Bientôt » à lien ; titres des cartes = `h1` des guides.
- [ ] JSON-LD, canonical, og/twitter (`og.jpg` 1200x630, alt descriptif) à jour.
- [ ] Pager des guides voisins mis à jour.
- [ ] Contrôle headless à 375 et 1280 px : 0 erreur console, 0 requête en échec, 0 image cassée, `scrollWidth == clientWidth`, vidéo `readyState 4`.
- [ ] Focus visible sur les cartes (`:focus-within`), vidéo pausable (`controls`).
- [ ] Poids : images < 250 Ko, vidéo < 3 Mo, page < 4 Mo.
- [ ] Aucun commentaire interne (check-list, gabarit) dans le HTML publié : les garder dans `guides-capture/`.
