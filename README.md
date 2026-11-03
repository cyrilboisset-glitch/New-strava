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

Autres façons d'importer : bouton **Importer un fichier** (zip ou .fit),
ou partager un .fit depuis Gadgetbridge vers l'appli installée.

## Avancement

| Étape | Contenu | État |
|---|---|---|
| 1 | Import du zip / des FIT, liste des sorties par mois | **Fait** |
| 2 | Détail d'une sortie : carte, courbes, zones, FTP réglable | À faire |
| 3 | Historique et charge d'entraînement (forme / fatigue) | À faire |
| 4 | Générateur de traces GPX, envoi au BiNavi via Gadgetbridge | À faire |
| 5 | Séances de la montre Amazfit Active 3 Premium | À faire |

## Tests

```
node tests/test-fit.mjs
```

Compare le lecteur FIT avec des valeurs de référence (fitparse). Les
fichiers de `tests/donnees/` sont des sorties réelles et ne sont pas
publiés : sans eux, le test ne vérifie rien.
