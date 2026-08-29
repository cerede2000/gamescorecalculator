# P0 — validation du noyau de calcul et du langage de formules

Prototype **jetable**. Son unique rôle : décider si le noyau proposé au volume 4
tient, avant d'engager le MVP. Il ne contient ni interface, ni base, ni API, ni
la moindre règle de jeu.

## Exécuter

```bash
node --experimental-strip-types verdict.ts     # P0  — noyau numérique et classement
node --experimental-strip-types verdict-b.ts   # P0b — langage de formules
```

Node 25, aucune dépendance. Le processus sort en code 0 si et seulement si
**tous les tests passent** *et* **aucune primitive hors noyau n'a été nécessaire**.

## Condition de sortie, rendue mécanique

La liste des primitives du noyau est figée dans `src/engines.ts` :

```
add sub mul div abs sum min max cmp bracket
chain scope rankMode missingPolicy onDemand
```

Chaque moteur de validation déclare les primitives qu'il utilise. Le juge refuse
tout moteur qui en exigerait une autre. La condition « aucune primitive ajoutée »
n'est donc pas une affirmation : c'est un contrôle.

## Ce qui est vérifié — 56 contrôles

| Bloc | Objet |
|---|---|
| 1 | Arithmétique exacte : `0,1 + 0,2 = 0,3`, rationnels, échelles mixtes, négatifs |
| 2 | Le **moment** de l'arrondi change le résultat — `0,99` contre `1,00` |
| 3 | Propagation de l'inconnu : jamais converti en zéro (RG-12) |
| 4 | Aller-retour de sérialisation exact sur les huit domaines |
| 5 | Les huit moteurs de validation |
| 6 | Départage progressif : aucune question superflue (EF-113, EF-114) |
| 6bis | Les exemples chiffrés des dossiers Flip 7, Akropolis et Moon Colony |
| 7 | Déterminisme : l'ordre de saisie ne change pas le classement (RG-07) |
| 8 | Comparaisons illégales détectées à l'exécution |

## Les huit moteurs de validation

| Moteur | Ce qu'il prouve |
|---|---|
| `fic.moindre-pli` | Le score le plus faible gagne alors qu'un seuil élevé déclenche la fin |
| `fic.ardoise` | Décimaux exacts, valeurs négatives, total passant sous zéro |
| `fic.expedition` | Portée `TABLE`, victoire collective sans score individuel |
| `fic.double-voie` | Victoires ordonnées : le dernier survivant gagne avec 23 points contre 88 |
| `fic.course-des-cols` | `ORDINAL`, abandon placé en dernier et jamais compté comme zéro |
| `fic.tournoi-demis` | Rationnels `1`, `½`, `0` conservés exacts, rang 1 partagé |
| `fic.solo-atelier` | Échelle de performance, résultat gradué sans gagnant |
| `fic.departage-progressif` | **7 questions posées au lieu de 16**, « troops » jamais atteint |

## Résultat

```
Verdict P0   56 réussis · 0 échoués
Aucune primitive ajoutée au noyau.
```

**Le noyau du volume 4 est validé.** Les dix stratégies de classement demandées
s'expriment bien avec une seule chaîne de comparateurs et une portée de résultat.

## Ce que P0 a trouvé

Un bug réel dans la première version de `rank.ts` : `resolvedBy` retenait le
**premier** critère ayant scindé un groupe au lieu du **dernier**. Duncan était
annoncé départagé « aux Points de Victoire » alors qu'il l'était « à l'Eau ».
Corrigé, avec le commentaire qui explique pourquoi.

## Ce que P0 ne fait pas

Pas de langage de formules, pas de conditions de fin, pas d'assistant de mise en
place, pas de persistance, pas d'API. Ces éléments relèvent du MVP et de la
spécification, pas de la validation du noyau.

## Limites connues

- Les huit domaines sont implémentés, mais `VECTOR` n'est exercé qu'en
  sérialisation et en comparaison lexicographique.
- `bracket` est déclaré comme primitive et utilisé par `fic.solo-atelier`, mais
  la valeur graduée est fournie précalculée : la fonction elle-même relève du
  langage de formules, hors périmètre P0.
- Aucune mesure de performance. Le rejeu est trivialement rapide à cette échelle,
  mais le seuil de 5 ms d'ENF-11 reste à vérifier sur une partie complète.


---

# P0b — validation du langage de formules

P0 avait validé la moitié de la thèse « un jeu est une donnée » : le noyau
numérique et la chaîne de classement. P0b valide l'autre moitié — le **langage
dans lequel un plugin exprime ses calculs de score**.

## Condition de sortie

Langage figé à **19 primitives** dans `src/formula.ts` :

```
lit ref if  add sub mul div  sumOver count countDistinct bracket
eq gt gte lt lte  and or not
```

Le juge refuse toute expression employant un opérateur hors de cette liste.

## Ce qui est vérifié — 50 contrôles

Les **quatre vrais jeux** exprimés en formules déclaratives, sur 13 cas repris
des dossiers. Pour chacun : la valeur attendue, l'invariant RG-05 (somme des
lignes = total), et — pour les jeux à deux modes — l'équivalence stricte entre
saisie express et saisie guidée.

| Jeu | Cas | Primitives employées |
|---|---:|---|
| `flip7` | 3 | `countDistinct eq gt if lit mul ref sumOver` |
| `akropolis` | 3 | `add and gte if lit mul ref sumOver` |
| `moon-colony` | 4 | `add not ref sumOver` |
| `dune-imperium` | 3 | `add ref` |

## L'équivalence des deux modes, par construction

Les contributions sont **littéralement identiques** entre express et guidée.
Seules les *dérivations* changent : la guidée calcule les valeurs que l'express
reçoit en entrée. `ref('numberSum')` lit une entrée en express, une dérivation
en guidée, et rend le même texte dans les deux cas.

C'est EF-051 obtenu par construction plutôt que par discipline — et le test
`sameReport` le vérifie ligne à ligne, formule comprise.

## Résultat

```
Verdict P0b   50 réussis · 0 échoués
Aucune primitive ajoutée. Les quatre jeux s'expriment avec la liste figée.
```

**La thèse tient de bout en bout.** Un jeu est bien une donnée : ni code
exécutable, ni opérateur ajouté pour un cas particulier.

## Ce que P0b a trouvé

Un défaut d'explicabilité réel. Le rendu des formules aplatissait les
parenthèses :

```
Marchés    5 + 2 × 0 × 2 = 10        ← faux : se lit 5 + (2×0×2) = 5
Marchés    (5 + 2 × 0) × 2 = 10      ← corrigé
```

La *valeur* était juste, l'*explication* mentait sur le calcul — un manquement
direct à EF-077. Corrigé par un système de priorités qui parenthèse tout enfant
moins prioritaire que son parent.

## Règles confirmées le 29 août 2026

- **Flip 7** : le paquet ne contient **qu'un seul `x2`**. Le cumul est
  impossible, le champ est un booléen définitivement. La politique provisoire
  `x2Stacking` est retirée.
- **Flip 7** : les Bonus sont les **valeurs paires de +2 à +10**. Le pavé de
  saisie propose 5 valeurs au lieu d'une entrée libre.
- **Moon Colony** : les jetons du Moon Base et les habitants imprimés sont
  **deux populations distinctes**. L'addition est correcte — le seul point
  ouvert qui pouvait fausser un score est fermé.

## Limites de P0b

- `bracket`, `div`, `count`, `sub`, `lt`, `lte`, `or` sont implémentés et testés
  unitairement, mais **aucun des quatre jeux ne les emploie**. Leur nécessité
  reste à démontrer sur un cinquième jeu.
- Le langage n'a pas de vérificateur de types statique : une expression est
  validée à l'évaluation. Un contrôle à la publication reste à écrire.
- Les conditions de fin ne sont pas couvertes : P0b valide le calcul de score,
  pas la détection de fin de partie.
