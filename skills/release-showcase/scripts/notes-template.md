<!--
  Squelette des notes de release (à copier hors du repo, par ex. dans le scratchpad, puis : gh release edit <tag> --notes-file <fichier>).
  Remplacer les {{...}}, supprimer les commentaires et les sections vides.
  Titres de section : adapter à la langue du README (FR : Points forts / Ajouts / Modifications / Corrections / Sécurité / Installation / Crédits).
  Toutes les URL d'images sont absolues : https://raw.githubusercontent.com/{{OWNER}}/{{REPO}}/{{BRANCH}}/docs/releases/{{TAG}}/<fichier>
  Largeur des images : 720 pour une illustration de point fort, 100% pour la bannière.
-->

<p align="center">
  <img src="{{BANNER_URL}}" alt="{{PROJECT}} {{TAG}}" width="100%">
</p>

{{LEAD: une ou deux phrases, orientées utilisateur : ce que la release permet de faire, sans jargon interne.}}

## Highlights

### {{HL1_TITLE}}

<p align="center">
  <img src="{{HL1_URL}}" alt="{{HL1_ALT}}" width="720">
</p>

{{HL1_TEXT: deux ou trois lignes : le bénéfice, puis le comportement concret.}}

### {{HL2_TITLE}}

<p align="center">
  <img src="{{HL2_URL}}" alt="{{HL2_ALT}}" width="720">
</p>

{{HL2_TEXT}}

<!-- Ajouter HL3 à HL5 sur le même modèle. Pas plus de cinq points forts. -->

## Added

- {{ITEM: tiré du CHANGELOG, reformulé en une ligne claire}}

## Changed

- {{ITEM}}

## Fixed

- {{ITEM}}

## Security

- {{ITEM: protections et correctifs de sécurité, sans détail exploitable}}

## Installation

{{INSTALL_STEPS: fichiers à télécharger, somme de contrôle, première ouverture (ex. Gatekeeper pour une app non signée), prérequis}}

```sh
shasum -a 256 -c {{ASSET}}.sha256
```

## Known limitations

- {{ITEM: optionnel, seulement ce qui est vrai pour cette version}}

---

**Full changelog**: {{CHANGELOG_URL}}

## Credits

{{CREDITS: contributeurs, crédits d'images tierces, données de démonstration. Aucune donnée personnelle.}}
