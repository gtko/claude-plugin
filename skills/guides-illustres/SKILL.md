---
name: guides-illustres
model: sonnet
description: Produit des guides utilisateur illustrés (pages HTML d'un site, avec captures réelles de l'app, courtes vidéos MP4 et image de partage) à partir du code d'une application web. À utiliser quand on demande « fais un tuto / guide / how-to pour <fonctionnalité> », « des guides avec captures, GIF ou vidéos », « documente le parcours X pour les utilisateurs », documenter un parcours utilisateur avec des captures d'écran headless, ou mettre à jour les captures d'un guide existant après un changement d'interface.
---

# Guides illustrés

Méthode éprouvée sur les guides Laststream (profils, profil enfant, extension Stremio, TV M3U). Résultat : un sommaire `/guides/`, une page par parcours, chaque étape avec sa capture, une vidéo de 15-20 s par guide, tout régénérable par script.

Les chemins (`public/guides/`, `guides-capture/`), la stack (dev server, API locale) et le déploiement statique sont ceux de cet exemple : les adapter à la structure du projet cible.

## Règles non négociables

- **Jamais de navigateur visible** : Playwright `headless: true` partout, y compris pour vérifier les pages. Ignorer toute suggestion d'ouvrir un aperçu.
- **Tout en local** : app servie par son dev server, API lancée en local avec un dossier de données neuf, compte de test généré. Aucun appel à la production.
- **Identifiants de test** dans un `.env.test` ignoré par git, jamais affichés dans un rapport.
- **Aucun contenu tiers** à l'image : catalogue factice (titres inventés, images dont on a les droits), hôtes externes bloqués.
- **Le texte vient du code**, pas de la mémoire : libellés exacts entre « », chemins de menus, limites chiffrées, messages d'erreur recopiés tels quels.

## Déroulé

1. **Explorer** (agent de lecture) : pour chaque parcours, libellés exacts, chemin d'accès, champs, limites, messages d'erreur, avec `fichier:ligne`. Demander aussi la liste des autres fonctionnalités visibles : c'est la source des « autres cas d'usage » à proposer.
2. **Rédiger le texte** dans un doc relisable (doc Claude ou Markdown) : une section par guide, étapes numérotées, « Bon à savoir », FAQ, et « Visuels à prévoir » par section. Proposer d'emblée 6-8 guides supplémentaires en tableau (guide · ce qu'on apprend · où dans l'app).
3. **Monter la capture** (`guides-capture/` hors du dossier publié) : smoke test qui démarre API + app et capture un premier écran. Voir [references/capture.md](references/capture.md).
4. **Gabarit HTML** en parallèle : sommaire + un premier guide complet qui sert de modèle. Voir [references/page.md](references/page.md).
5. **Un script de capture par guide** (ou par groupe de guides qui partagent un état), chacun sur **son propre port d'API et son dossier de données** pour tourner en parallèle.
6. **Regarder chaque image** (outil Read sur le WebP) : c'est là qu'on trouve les défauts (menu mal surligné, bouton fixe qui chevauche, accueil vide, affiche inadaptée au profil).
7. **Intégrer** : copier vers `public/guides/<slug>/`, variantes 1280 px, `srcset`, `og.jpg` 1200x630.
8. **Relecture finale** par un relecteur qui **lit les images** et confronte chaque étape à sa capture et au code. Elle trouve les phrases fausses (ex. « les sources apparaissent sur la fiche » alors qu'elles sont dans le lecteur).
9. **Livrer** : vérifier `git status` du site avant tout déploiement (voir Coordination).

## Kit de capture

`scripts/capture-kit.mjs` (démo : `scripts/demo.mjs`) fournit : curseur factice avec onde au clic, déplacements de souris lissés, frappe lente, attente du calme réseau, capture qui masque le curseur et retire son temps mort du clip, montage ffmpeg, WebP sous plafond de poids, variante 1280, poster, og.jpg, garde réseau (local autorisé, mocks, reste bloqué et listé). Playwright est passé en paramètre : réutiliser celui du projet.

Prérequis : `ffmpeg` dans le PATH, Playwright installé dans le projet.

```js
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const K = await import(pathToFileURL(join(homedir(), '.claude/skills/guides-illustres/scripts/capture-kit.mjs')).href);
const { chromium } = await import(pathToFileURL(join(projet, 'node_modules/playwright/index.mjs')).href);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: K.VIEWPORT, deviceScaleFactor: 2, locale: 'fr-FR', recordVideo: { dir: videoDir, size: K.VIEWPORT } });
const blocked = await K.guardNetwork(context, { mock: (url) => monMock(url) }); // avant toute navigation
await context.addInitScript(K.CURSOR_SCRIPT);
const page = await context.newPage();
const s = K.createSession(page);                          // avant page.goto
await page.goto(appUrl);
s.clip.start = K.now(s);
await K.click(s, page.getByRole('button', { name: 'Ajouter un profil' }));
await K.typeIn(s, page.getByLabel('Nom'), 'Léo');
await K.parkCursor(s);
await K.snap(s, '03-nouveau-profil', tmpDir);            // PNG ; ce temps est retiré du clip
s.clip.end = K.now(s);

await context.close();                                    // obligatoire avant video.path()
const segs = K.keptSegments(Math.max(0, s.clip.start - 0.1), s.clip.end + 0.2, s.cuts);
K.cutClip(await s.video.path(), join(out, 'clip.mp4'), segs);
for (const sh of s.shots) { K.toWebp(sh.png, join(out, 'img', `${sh.name}.webp`)); K.variant(sh.png, join(out, 'img', `${sh.name}-1280.webp`)); }
K.posterFrom(join(out, 'clip.mp4'), join(out, 'img/poster.webp'));
K.ogImage(join(out, 'img/poster.webp'), join(out, 'img/og.jpg'));
await browser.close();
```

Exemple complet et testé : `node scripts/demo.mjs` (variable `PLAYWRIGHT_PATH` vers `playwright/index.mjs` du projet). Fonctions utiles en plus : `waitNetQuiet`, `waitScrollSettled`, `parkCursor`, `unfilmed(s, fn)` (attente retirée du clip), `probeMedia(file)`.

## Pièges rencontrés (lire avant d'écrire un scénario)

Détails et parades dans [references/capture.md](references/capture.md#pièges). En bref :
- **Re-rendu tardif** qui efface une saisie ou fait disparaître un formulaire : attendre le calme réseau, puis vérifier la valeur du champ avant de valider. Si ça arrive aussi à la main, c'est un bug de l'app : le signaler.
- **Menu « scroll-spy » mal surligné** après défilement : cliquer l'entrée du menu au lieu de défiler.
- **Éléments fixes** (bouton retour, bandeaux) qui recouvrent le contenu : cadrer en haut de page ou masquer par CSS injecté dans le navigateur de test seulement.
- **Ports déjà pris** par d'autres sessions : ports dédiés par script, URL de l'app en variable (`CAPTURE_APP_URL`), origine ajoutée à la liste CORS de l'API.
- **Contenu absent sans clé d'API** (catalogue vide, messages d'erreur) : mocker par `page.route()`, avec des données cohérentes avec le parcours (ex. classifications d'âge compatibles avec un profil enfant).
- **Les captures révèlent de vrais bugs** (ex. 403 à la création d'un profil enfant) : corriger dans l'app à part, rejouer la capture comme test de non-régression.

## Exemples servis en local

Quand un guide montre une saisie d'URL (extension, playlist, flux), servir un **exemple réel** sur un port local avec CORS ouvert, identique au code montré dans le guide : le texte et l'image disent la même chose, et l'exemple sert de démo installable. Ajouter dans le guide une phrase expliquant que l'adresse `http://localhost` des captures est celle de l'exemple.

## Coordination et livraison

- Le dossier du site peut être modifié par une autre session en même temps : `git status` et `git diff` avant de commiter ou déployer. Commiter **seulement** ses chemins (`git commit -- public/guides guides-capture`).
- Un déploiement statique publie tout le dossier tel qu'il est sur le disque : ne pas déployer par-dessus le travail non commité d'un autre. Prévenir l'autre session et convenir de qui déploie.
- Vérifier en ligne (`curl -o /dev/null -w '%{http_code}'`) chaque page, une vidéo et une og.jpg.

## Découpage conseillé en agents

Lecture du code → agent de lecture. Gabarit HTML, scripts de capture, intégration → agents de code en parallèle (dossiers distincts : `public/guides` contre `guides-capture`). Un relecteur après le gabarit et un à la fin (qui lit les images). L'orchestrateur garde : le texte, le regard sur chaque image, les arbitrages.
