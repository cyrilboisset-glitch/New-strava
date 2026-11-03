# CLAUDE.md — Mes sorties (dépôt New-strava)

Contexte pour reprendre le projet. Tout le projet est en français.

## Projet

Appli web installable (PWA) qui remplace Strava pour Cyril : récupérer
ses sorties vélo, les afficher et les analyser, et générer des traces
GPX. Téléphone **Xiaomi 14T (Android, HyperOS)**, ordinateur PC Windows.
Hébergée sur **GitHub Pages** (dépôt public) ; les données de Cyril ne
vont jamais dans le dépôt, elles restent dans le navigateur du
téléphone (IndexedDB).

## Chaîne de récupération (validée le 3 nov. 2026)

1. Compteur **iGPSport BiNavi** → **Gadgetbridge** (appli Android libre,
   installée depuis F-Droid), appairé sans l'appli iGPSport.
2. L'export FIT automatique de Gadgetbridge **ne marche pas pour
   iGPSport** (branché seulement pour Garmin, CMF, Huawei, Bangle.js,
   Huami, Xiaomi — PR Gadgetbridge #6268). Testé : rien n'est exporté.
3. On passe par l'**export zip automatique** de Gadgetbridge (sauvegarde
   complète), qui contient bien les FIT d'origine du compteur. Cyril l'a
   réglé vers un dossier du téléphone.
4. L'appli relie ce dossier (`showDirectoryPicker`), lit le zip le plus
   récent, garde les FIT de type activité (file_id.type = 4) et ignore
   ceux déjà importés (identifiant = n° de série + heure de création ;
   doublon aussi si même départ à 1 min près).
5. Solutions de secours : bouton « Importer un fichier » (zip ou .fit),
   et partage d'un .fit depuis Gadgetbridge (share target du manifeste,
   traité dans `sw.js`).

⚠ À vérifier sur le téléphone de Cyril : que l'accès au dossier tient
d'une ouverture à l'autre (sinon un appui sur « Synchroniser » suffit).

## Ce qu'on sait des FIT du BiNavi (sortie du 12 oct. 2026)

- Fichier d'origine du compteur : fabricant `igpsport`, produit 801,
  logiciel 1.58. Gadgetbridge le transmet tel quel.
- Enregistrement **pas à la seconde** : intervalles de 1 à 9 s, le plus
  souvent 8 s (645 points pour ~58 min). Les pics courts (5 s, 1 min)
  seront imprécis. Le manuel ne documente pas de réglage « 1 s » ; seul
  le mode économie de batterie réduit la fréquence.
- NP recalculée depuis les points (remplissage seconde par seconde) :
  165,2 W, contre 165 W dans la session du compteur.
- FTP dans `zones_target` : **236 W**. Une note plus ancienne dit 225 W :
  demander à Cyril laquelle garder (il y a une détection auto de FTP sur
  le compteur). L'étape 2 doit permettre de régler la FTP dans l'appli.
- Pédalage : équilibre G/D et fluidité présents ; phase de puissance et
  efficacité du couple présents mais vides sur cette sortie.
- Champs propres à iGPSport (développeur) : training_load, teAerobic,
  teAnaerobic, stamina.
- La boîte englobante de la session (swc) vaut 0,0 : la recalculer.

## Où est quoi

```
index.html, css/app.css     Interface (thème sombre/clair)
js/fit.js                   Lecteur FIT (sans dépendance), testé
js/sortie.js                Résumé d'une sortie pour la liste
js/import.js                Import zip / FIT / dossier, anti-doublons
js/db.js                    IndexedDB : sorties, fichiers FIT, réglages
js/app.js                   Carte de synchro + liste par mois
sw.js                       Hors ligne + réception des partages
manifest.webmanifest        Installation + share target
vendor/jszip.min.js         JSZip 3.10.1 (MIT)
fonts/                      Barlow Condensed (OFL)
tests/test-fit.mjs          Comparaison avec fitparse (node tests/test-fit.mjs)
tests/donnees/              Sorties réelles, NON versionnées
```

## Méthode de travail (demandée par Cyril)

Avancer **étape par étape** et montrer chaque étape avant la suivante.
Réponses directes et pratiques. **Vérifier les chiffres** (watts,
temps, distances) et les termes techniques avant de les affirmer : Cyril
a déjà relevé des erreurs de ce type.

## Règles du code

- Identifiants et commentaires en français, sans accents dans les
  identifiants ; textes affichés en français correct.
- Unités dans les noms : `puissanceW`, `dureeS`, `distanceM`.
- Aucune requête réseau pour les données : tout est local. Les
  bibliothèques sont copiées dans `vendor/`.
- À chaque mise en ligne : changer `VERSION` dans `sw.js` (sinon le
  téléphone garde l'ancienne version) et `VERSION_APPLI` dans `js/app.js`.
- Avant de dire que c'est fait : `node tests/test-fit.mjs`, et vérifier
  l'appli dans un navigateur à la taille d'un téléphone.
