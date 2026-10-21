---
name: genere-sons
description: Génère des effets sonores et ambiances de jeu via l'API ElevenLabs (sound generation). À utiliser quand il faut créer des sons — bruitages d'action (attaque, pose de carte, construction), jingles (victoire, défaite, level-up), soins, pièces, ambiances courtes — pour un jeu ou une appli. Sortie MP3 ; clé lue dans ELEVENLABS_API_KEY (obligatoire).
---

# Génère-sons — effets sonores via ElevenLabs

## Quand l'utiliser

Dès qu'un projet a besoin d'effets sonores ou de petits jingles : actions de jeu,
feedbacks d'interface, transitions. Le script produit un MP3 par prompt.

## Commande

```bash
python scripts/generate_sound.py --prompt "<description en anglais>" --out fichier.mp3 [--duration S] [--influence 0..1] [--count N]
```

- **--duration** : 0.5 à 22 s. Sons UI courts : 0.6–1.2 s. Jingles : 2–4 s. Omis = auto.
- **--influence** (défaut 0.4) : plus haut = colle au prompt, plus bas = créatif.
- **--count** : variantes `_1.mp3`, `_2.mp3`… pour choisir la meilleure.
- Clé : variable d'environnement `ELEVENLABS_API_KEY`, obligatoire. Sans elle, le script s'arrête avec un message d'erreur (exit non nul). Ne jamais écrire la clé dans le dépôt.

## Écrire de bons prompts

- **En anglais**, décrire la matière + l'action : `"heavy stone block slammed down, dust settling"`.
- Préciser la brièveté pour l'UI : `"short, snappy, single hit"`.
- Ajouter `"no music, no melody"` pour un bruitage pur ; à l'inverse `"short fanfare"` pour un jingle.
- Pour un jeu médiéval-fantasy : `"medieval"`, `"fantasy game sound effect"` aident à ancrer le ton.

## Exemples éprouvés (jeu Empires)

| Usage | Prompt | Durée |
|---|---|---|
| Pose de carte | quick playing card snapped down on a wooden table, short snappy flick, no music | 0.8 |
| Construction | heavy stone building placed with a deep thud and settling dust, fantasy game, no music | 1.2 |
| Level-up / âge | short triumphant magical level up fanfare, brass and shimmer, medieval fantasy game | 2.5 |
| Victoire | victorious medieval trumpet fanfare, triumphant, short | 3.5 |
| Défaite | somber low horn of defeat, falling sad tone, short, medieval | 3 |
| Épée | sword slash hitting metal armor, sharp metallic clash, short, no music | 0.9 |
| Arc | arrow whoosh flying then thunk into wood, short, no music | 1 |
| Siège | catapult launch whoosh and heavy stone impact with rubble, short, no music | 1.5 |
| Soin | soft magical healing chime, warm gentle sparkle, short, no music | 1.2 |
| Mort d'unité | fantasy unit destroyed, crumble and dissipating poof, short, no music | 1 |
| Or | gold coins clinking into a leather purse, short, no music | 0.8 |
| Pioche | single card sliding and flicked from a deck, paper, very short, no music | 0.6 |

## Intégration côté jeu (HTML)

```js
function sfx(name){if(typeof Audio==='undefined'||muted)return;
  const a=new Audio('sfx/'+name+'.mp3');a.volume=0.45;a.play().catch(()=>{});}
```

## Notes

- L'API renvoie du MP3 (`audio/mpeg`) directement, pas de post-traitement requis.
- Coût par génération : quelques centaines de crédits caractères ElevenLabs — générer une fois, committer les fichiers.
- Erreur 401 = clé invalide/expirée ; 429 = quota atteint.
