# Mes sorties

Appli perso pour suivre mes sorties vélo **sans Strava**. Les sorties
viennent du compteur iGPSport BiNavi, récupérées par
[Gadgetbridge](https://gadgetbridge.org) sur le téléphone. Tout reste
sur le téléphone : rien n'est envoyé sur internet.

## Comment ça marche

```
BiNavi ──Bluetooth──> Gadgetbridge ──export auto du zip──> dossier du téléphone
                                                              │
                                     Mes sorties (cette appli) lit le zip le plus récent
                                     et importe les sorties qu'elle ne connaît pas
```

1. Dans Gadgetbridge : Paramètres → Automatisations → export automatique
   du zip, vers un dossier (par exemple `Documents/Gadgetbridge`).
2. Ouvrir l'appli dans Chrome, puis menu ⋮ → **Installer l'application**.
3. Dans l'appli : **Choisir le dossier Gadgetbridge**.

Autres façons d'importer : bouton **Importer un fichier** (zip, .fit,
.gpx, .tcx, compressés .gz ou non), ou partager un .fit depuis
Gadgetbridge vers l'appli installée.

### Anciennes sorties Strava

1. Sur strava.com : Paramètres → Mon compte → Télécharger ou supprimer
   votre compte → Demander une archive. Le lien arrive par mail.
2. Télécharger le zip **sur le téléphone** (les données restent dans
   l'appli de ce téléphone), sans le décompresser.
3. Dans l'appli : **Importer un fichier** → choisir le zip.

L'appli lit `activities.csv` (noms et types des sorties) et les fichiers
de `activities/` (FIT, GPX, TCX, souvent en `.gz`). Les sorties saisies
à la main sur Strava sont reprises depuis le CSV, sans trace. Les sorties
déjà présentes (même départ à 1 min près) ne sont pas doublées ; elles
reçoivent juste leur nom Strava. Si l'import est interrompu, il suffit
de le relancer.

## Avancement

| Étape | Contenu | État |
|---|---|---|
| 1 | Import du zip / des FIT, liste des sorties par mois | **Fait** |
| 1 bis | Import de l'archive Strava (FIT, GPX, TCX, CSV) | **Fait** |
| 1 ter | Tri de la liste par activité (Vélo, Marche, Musculation…) | **Fait** |
| 2 | Détail d'une sortie : carte, courbes, zones, FTP réglable | **Fait** |
| 3 | Historique et charge d'entraînement (forme / fatigue) | À faire |
| 4 | Générateur de traces GPX, envoi au BiNavi via Gadgetbridge | À faire |
| 5 | Séances de la montre Amazfit Active 3 Premium | À faire |

## Tests

```
node tests/test-fit.mjs
node tests/test-strava.mjs
node tests/test-analyse.mjs
node tests/test-strava-navigateur.cjs
```

Compare le lecteur FIT avec des valeurs de référence (fitparse). Les
fichiers de `tests/donnees/` sont des sorties réelles et ne sont pas
publiés : sans eux, le test ne vérifie rien.
