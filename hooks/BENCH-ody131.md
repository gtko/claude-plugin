# Mesure ODY-131 : latence d'un PreToolUse Bash

Entrée : `{"tool_name":"Bash","tool_input":{"command":"ls"}}`. 20 exécutions après 2 échauffements, HOME neuf à chaque lancement, Windows 11, Node v26.8.1. Script de mesure non commité.

| Configuration | Moyenne | Médiane | Min – max |
|---|---|---|---|
| Avant : heavy-gate, process-gate, tool-guard lancés l'un après l'autre (somme) | 292,6 ms | 281,7 ms | 251,5 – 409,8 ms |
| Avant : les trois en parallèle (temps mur, ce que vit Claude Code) | 176,6 ms | 170,6 ms | 155,8 – 227,3 ms |
| Après : `dispatch.js PreToolUse` (un processus) | 100,0 ms | 100,5 ms | 93,2 – 107,2 ms |
| Référence : `node -e ""` (coût d'un processus node) | 89,4 ms | 79,3 ms | 71,4 – 168,1 ms |

Lecture :
- Le coût dominant est le démarrage de node (environ 80 à 90 ms ici). Après la fusion, il n'est payé qu'une fois ; le chargement des trois modules ajoute environ 10 ms.
- Claude Code lance en parallèle les hooks qui correspondent à un même appel. Le gain réellement ressenti est donc celui de la ligne « en parallèle » : 176,6 → 100,0 ms, soit -43 %. La somme (-66 %) est une majoration.
- Hors mesure : le hook externe claude-dojo (`~/.config/claude-dojo/hook.js`, asynchrone, hors `claude/hooks/`) reste un processus à part sur PreToolUse et sur les autres événements.
