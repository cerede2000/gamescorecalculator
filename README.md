# Tablée

Assistant de comptage de points pour jeux de société. L'application **prépare la
table, puis compte**. Entre les deux, la partie se joue physiquement et
l'application n'en sait rien.

La thèse tient en une phrase : **un jeu est une donnée, pas du code.** Les cinq
jeux du catalogue sont des fichiers JSON chargés à l'exécution. Le cœur ne
contient aucun terme de jeu, aucune valeur codée en dur, aucun import de jeu —
c'est vérifié à chaque intégration.

## Lancer

```bash
docker run -d -p 8080:8080 -v tablee-data:/data --name tablee ghcr.io/cerede2000/gamescorecalculator:latest
```

Ou avec Compose :

```bash
docker compose up -d
```

Puis <http://localhost:8080>. La base vit dans `/data`, l'image reste jetable.

Sans Docker, avec Node 25 :

```bash
npm start
```

Aucune dépendance à installer : le projet n'en a aucune, ni au serveur, ni au
client, ni au noyau.

### Réglages

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `8080` | port d'écoute |
| `HOST` | `0.0.0.0` | interface d'écoute |
| `DATA_DIR` | `/data` | dossier de la base |
| `TABLEE_DB` | `$DATA_DIR/tablee.db` | chemin complet de la base |

## Vérifier

```bash
npm test
```

Cinq portes, 348 contrôles, aucune dépendance :

| Commande | Ce qu'elle prouve |
|---|---|
| `npm run validate` | la porte de publication refuse un bundle non conforme |
| `npm run play` | les seize parties de référence, jouées par le noyau |
| `npm run e2e` | les mêmes parties, rejouées **à travers l'API HTTP** |
| `npm run p0` | l'arithmétique exacte et le classement |
| `npm run p0b` | le langage de formules et son explication |

## Ce que ces commandes prouvent

- **Un jeu est une donnée.** Les cinq bundles sont du JSON chargé à
  l'exécution ; l'intégration continue échoue si un terme de jeu apparaît dans
  le noyau, fût-ce en commentaire.
- **La porte de publication est réelle.** Un champ sans `usedBy` est refusé, une
  référence morte est refusée, une collection employée mais non déclarée est
  refusée, une politique non confirmée sans question est refusée, et une partie
  de référence déclarée sans fichier est refusée.
- **Absent n'est pas zéro**, sauf là où le jeu le déclare. Un total incomplet
  vaut *inconnu*, la base interdit d'encoder un inconnu par une chaîne vide, et
  un jeu qui refuse de classer sur une donnée manquante le fait savoir. Un jeu
  peut déclarer l'inverse champ par champ (`whenAbsent`) : dans un décompte par
  catégories, ne rien avoir dans une catégorie est un fait ordinaire. Akropolis
  le fait, Dune non — et les deux comportements sont tenus par des tests.
- **Les résultats des dossiers sont reproduits.** Bruno 74 et Chloé 46 devant
  Ada 46 aux Pierres ; Cy gagne à 223 alors qu'Ana a déclenché la fin ; Bo et Cy
  partagent la victoire à 20 survivants ; Duncan l'emporte à l'Eau en
  **7 questions de départage au lieu de 16**.
- **Express et guidée donnent le même rapport**, formule comprise.
- **Les règles atteignent la saisie.** Un joueur éliminé ne peut plus rien saisir
  d'autre, les champs solo remplacent les champs multijoueur, la seule carte ×2
  du paquet ne se prend qu'une fois par manche, et la table ne peut pas déclarer
  plus de cubes Pierre que la boîte n'en contient.

## Les règles s'appliquent à la saisie

Deux mécaniques, toutes deux en données.

**La pertinence se déduit, elle ne se déclare pas.** Un champ dit déjà quelle
formule il sert (`usedBy`) et une formule dit déjà quand elle s'applique
(`when`) : il suffit de laisser cette information atteindre l'écran. Moon
Colony Bloodbath bascule entre saisie solo et multijoueur sans une ligne
écrite pour lui. Deux garde-fous : un champ qui figure dans sa propre
condition ne se désactive jamais lui-même — sinon on ne pourrait plus revenir
en arrière — et une contribution exclusive écarte tout le reste.

**Ce que vaut une case vide se déclare aussi.** Par défaut, absent veut dire
inconnu et l'inconnu se propage — c'est ce qui protège un décompte contre un
zéro inventé. Mais Akropolis multiplie chaque catégorie par ses étoiles : une
seule case vide rendait le total entier inconnu, et il fallait remplir seize
cases dont quatorze à zéro. Le champ peut donc déclarer `whenAbsent`, et la
porte de publication refuse qu'un champ soit à la fois `required` et pourvu
d'un défaut, ou que le défaut sorte du domaine annoncé. L'écran n'enregistre
que ce qui a été réellement saisi : un défaut jamais touché reste absent de la
base, c'est le moteur qui le fournit.

Ce que chaque jeu y gagne :

| Jeu | Pertinence déduite | Matériel déclaré |
|---|---|---|
| Flip 7 | éliminé → plus rien d'autre à saisir | carte N en N exemplaires, une carte 0, un ×2, un de chaque bonus, 30 points de bonus en tout, pas de doublon chez un joueur |
| Moon Colony Bloodbath | solo ↔ multijoueur, variante longue, objectif atteint | rien de confirmé |
| Akropolis | rien à masquer : les cinq catégories comptent toujours | 40 cubes Pierre, et une Cité bornée par le nombre de tuiles en jeu |
| Ark Nova | rien à masquer : deux nombres, tous deux nécessaires | rien de confirmé |

Akropolis est le seul jeu à déclarer qu'une case vide vaut zéro : deux cases
suffisent à compter un joueur qui n'a que des Habitations.
| Dune: Imperium | rien à masquer : un seul champ | rien de confirmé |

**Le matériel est fini, et cela se déclare.** `scoringEngine.scarcity` porte
trois formes : `holders` (au plus N joueurs tiennent ce champ), `supply` (une
somme plafonnée, sur la table ou par joueur, sur un champ ou sur des
collections entières) et `copies` (chaque valeur d'une collection n'existe
qu'en tant d'exemplaires). Un plafond peut être **une expression** plutôt
qu'un nombre, quand le matériel dépend de la configuration. Une quantité affirmée sans
source déclenche un avertissement à la publication, et **une valeur dont le
nombre d'exemplaires n'est pas déclaré n'est pas limitée** : l'oubli laisse
passer, il ne bloque pas.

Exemple du plafond calculé : une tuile Cité d'Akropolis vaut 3 hexagones, la
boîte en contient 61, les piles en distribuent 3, 4 ou 5 selon le nombre de
joueurs, la dernière tuile du Chantier n'est jamais jouée et la tuile de
départ apporte 3 Quartiers — d'où 48 Quartiers au plus à 4 joueurs, 63 à 3 et
93 à 2. À chaque fois la configuration la **plus généreuse** est retenue
(partie longue comprise), pour qu'une limite ne puisse jamais refuser une
table légale. La borne est large : elle attrape une faute de frappe, pas une
erreur de comptage.

Le serveur reste l'autorité : il revérifie la table entière à chaque
enregistrement, et une valeur devenue sans objet ne compte plus comme du
matériel tenu — un joueur éliminé ne retient pas la carte des autres. L'écran
applique les mêmes contrôles **depuis la même source** : Node retire les types
du noyau à la volée et le sert au navigateur sous `/core/`, ce qui évite d'en
écrire une seconde version en JavaScript.

## Les cinq jeux

| Jeu | Joueurs | Saisie express | Départage |
|---|---|---|---|
| Flip 7 | 2 à ? | 5 champs par joueur | manche supplémentaire à 200+ |
| Akropolis | 2 à 4 | 16 champs par joueur | Pierres, puis victoire partagée |
| Moon Colony Bloodbath | 1 à 5 | 2 champs par joueur | aucun → victoire partagée |
| Dune: Imperium | 1 à 4 | 1 champ par joueur | Épice, Solaris, Eau, Troupes |
| Ark Nova | 1 à 4 | 2 champs par joueur | projets de conservation, puis victoire partagée |

Règles vérifiées contre les livrets officiels, sauf Flip 7 dont seule une
synthèse de deux pages est disponible.

**Les cinq jeux ont une fiche de mise en place.**

Ark Nova ne demande que deux nombres : l'attrait, et la **valeur écrite en
blanc** sur la case du marqueur de conservation. C'est exactement ce que le
livret demande de faire, et c'est tout le décompte. L'exemple du livret est
une partie de référence : 24+80 = 104 contre 30+78 = 108, et le joueur qui a
deux points d'attrait de moins l'emporte.

Une réserve y est déclarée plutôt que comblée : la table complète de la piste
de conservation n'est pas dans le livret, qui n'en montre que deux points. Les
images du PDF sont en 150 ppi et le plateau y tient en quelques centaines de
pixels : la table n'y est pas récupérable, ce n'est pas une question de zoom.
L'application demande donc la valeur lue sur le plateau au lieu de la position
du marqueur, et la question reste affichée dans la partie.

## Ce qu'il y a dans le dépôt

```
packages/rules-core/   le noyau — aucune règle de jeu, aucune E/S
games/*.json           les cinq jeux, en DONNÉES chargées à l'exécution
i18n/*.json            les libellés, également en données
fixtures/*.json        les parties de référence, avec leurs résultats attendus
server/                l'API — routeur maison sur node:http, base node:sqlite
client/                l'interface — modules ES servis tels quels, sans build
cli/                   les portes : publication, parties, bout en bout
p0/                    les prototypes de validation (jetables)
```

## Deux écarts assumés par rapport au cahier des charges

**La base est SQLite, pas PostgreSQL.** Le cahier des charges vise PostgreSQL 17.
Cette version emploie `node:sqlite`, intégré à Node : un conteneur unique, aucun
service externe, aucune dépendance — et l'application se teste sur une machine
sans base installée. Le schéma est du SQL portable et `server/store.ts` est le
seul fichier qui connaît le moteur.

**Le client n'a pas d'étape de compilation.** Plutôt que React et Vite, des
modules ES servis tels quels. Le dépôt entier reste sans dépendance, l'image se
construit en quelques secondes, et le rendu ne dépend d'aucune chaîne d'outils.

## Le périmètre, dit franchement

L'assistant de mise en place peut couvrir **moins de configurations** que le
moteur de score, et le déclare : `setupAssistant.playerCountRules`.

Dune: Imperium à un et deux joueurs utilise la Maison Hagal, dont la mise en
place figure sur une fiche séparée. Ces configurations sont **hors périmètre de
l'assistant** — décision produit, pas une dépendance manquante. Le décompte et
le classement restent disponibles de 1 à 4 joueurs.

## L'assistant de mise en place

L'application prépare la table avant de compter. Les fiches sont des données,
comme le reste : une suite d'étapes déclarées, chacune citant sa source, avec
des quantités qui **dépendent de la configuration**.

| Jeu | Étapes | Ce qui varie avec la table |
|---|---|---|
| Akropolis | 7 | 37 / 49 / 61 tuiles, 3 / 4 / 5 par pile, Chantier = joueurs + 2, Pierres 1·2·3·4 selon l'ordre du tour |
| Ark Nova | 15 | le solo remplace le pion Pause par la tuile Solo, l'attrait de départ passe de 0·1·2·3 à 20 |
| Dune: Imperium | 12 | le disque de Score démarre sur 1 à quatre joueurs, sur 0 sinon |
| Flip 7 | 2 | rien — mélanger, distribuer une carte |
| Moon Colony Bloodbath | 11 | le solitaire ajoute la carte Loneliness au paquet Progrès |

Trois formes de quantité : un nombre fixe, une **expression** évaluée sur les
métriques de cœur, ou une valeur **par siège** rendue avec le nom de chaque
joueur. Une étape peut porter une condition (`when`) : c'est ainsi que le mode
solo d'Ark Nova échange trois étapes sans dupliquer les douze autres.

La porte de publication refuse un assistant déclaré actif et vide, un
assistant inactif sans motif affiché, et avertit sur toute étape sans source —
une mise en place affirmée sans livret est une invention. Les 47 étapes
publiées citent toutes la leur.

Les coches de progression vivent dans le navigateur : c'est un rituel de début
de partie, pas une donnée de la partie.

## L'API

| Route | Rôle |
|---|---|
| `GET /api/health` | état, catalogue, bundles écartés |
| `GET /api/catalogue` | les jeux publiables |
| `GET /api/games/:id` | un bundle, libellés résolus |
| `GET · POST /api/matches` | lister, créer |
| `GET /api/matches/:id` | l'état complet : décompte, classement, question en cours |
| `PUT /api/matches/:id/rounds/:n` | enregistrer une manche |
| `POST /api/matches/:id/finish` · `/reopen` | clore, rouvrir |
| `POST /api/matches/:id/tiebreak` | répondre à une question de départage |
| `GET /api/matches/:id/journal` | le journal, en ajout seul |

Le serveur fait autorité : il revalide chaque valeur reçue contre le domaine
déclaré par le champ, et recalcule tout ce qu'il rend. Les mutations acceptent
`expectedVersion` (ou `If-Match`) pour la concurrence optimiste et `commandId`
pour l'idempotence — une commande rejouée rend son premier résultat sans rien
réappliquer.
