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

Testé par Cyril le 3 nov. 2026 sur son Xiaomi : l'accès au dossier ne
tient pas d'une ouverture à l'autre, il faut appuyer sur
« Synchroniser » (une autorisation Android à chaque fois). **Cyril dit
que ça lui convient** : ne pas chercher à le contourner.

Délai à connaître : une sortie n'apparaît dans l'appli qu'après le
prochain export zip de Gadgetbridge (fréquence réglée par Cyril). Pour
l'avoir tout de suite : Gadgetbridge → Paramètres → Automatisations →
lancer l'export maintenant (« Run AutoExport now »), puis Synchroniser.

## En ligne

- Adresse : https://cyrilboisset-glitch.github.io/New-strava/ (GitHub
  Pages, branche `main`, dossier racine). Installée sur le téléphone de
  Cyril comme appli (Chrome → Installer l'application).
- Nom affiché : « Mes sorties » (le dépôt s'appelle New-strava ; Cyril
  peut demander à renommer).

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
js/import.js                Import zip / FIT / GPX / TCX / dossier, anti-doublons
js/strava.js                Archive Strava : activities.csv, types, saisies à la main
js/trace.js                 Lecture GPX/TCX, résumé calculé depuis les points
js/db.js                    IndexedDB : sorties, fichiers FIT, réglages
js/app.js                   Carte de synchro, liste par mois, navigation (#sortie=…, #reglages)
js/detail.js                Page de détail : carte Leaflet, courbes + curseur, efforts, zones, tours
js/analyse.js               Calculs (sans navigateur) : points, NP, efforts, zones, IF/TSS, FTP estimée
js/profil.js                FTP / FC max (réglages), efforts gardés par sortie, estimation de FTP
js/reglages.js              Page Réglages
js/fichier.js               Relecture du fichier d'origine (FIT/GPX/TCX, .gz)
js/format.js                Mise en forme (nombres, durées, dates)
vendor/leaflet/             Leaflet 1.9.4 (BSD-2) ; fond OSM chargé en ligne
sw.js                       Hors ligne + réception des partages
manifest.webmanifest        Installation + share target
vendor/jszip.min.js         JSZip 3.10.1 (MIT)
fonts/                      Barlow Condensed (OFL)
tests/test-fit.mjs          Comparaison avec fitparse (node tests/test-fit.mjs)
tests/test-navigateur.cjs   Appli complète dans Chromium à 390 px (Playwright) :
                            import zip/fit, doublons, faux dossier, détail,
                            mois, hors ligne, partage Android. Captures dans
                            tests/captures/ (non versionné)
tests/test-strava.mjs       CSV, dates, GPX/TCX, calculs (données fabriquées)
tests/test-analyse.mjs      Efforts, zones, IF/TSS, FTP estimée (valeurs connues)
tests/test-strava-navigateur.cjs  Fausse archive Strava importée dans l'appli
tests/fausse-archive.mjs    Fabrique GPX, TCX, FIT et CSV aux valeurs connues
tests/donnees/              Sorties réelles, NON versionnées : sans elles les
                            deux tests ne vérifient rien. Fichiers attendus :
                            sortie-2026-10-12.fit (+ .ref.json pour test-fit)
```

## Prochaines étapes et demandes en attente

Étapes prévues (README) : 2 détail d'une sortie (carte Leaflet/OSM,
courbes, zones, **FTP réglable**), 3 historique et charge (CTL/ATL/TSB),
4 générateur de traces GPX (routage type BRouter) envoyées au BiNavi via
Gadgetbridge, 5 montre Amazfit.

Demandes posées le 3 nov. 2026, **Cyril a dit « ne fais rien pour
l'instant »** — à proposer quand il voudra :

- **Anciennes sorties Strava : FAIT le 3 nov. 2026** (v0.2.0). Import du
  zip d'archive Strava par « Importer un fichier » (`js/strava.js` pour le
  CSV, `js/trace.js` pour GPX/TCX et calculs). Testé seulement sur une
  fausse archive : l'archive réelle de Cyril fait 123 Mo, pas encore
  essayée. À vérifier sur la vraie : en-têtes et format de date du CSV
  (anglais ou français ?), colonnes « Distance » (km puis m supposé).
- **Tri par activité : FAIT le 3 nov. 2026** (v0.3.0, « étape 1 ter »).
  Boutons au-dessus de la liste, familles dans `familleSortie()`
  (`js/sortie.js`) : tous les vélos ensemble (route, gravel, VTT, home
  trainer, virtuel, électrique). Musculation séparée d'Entraînement
  (Weight Training / Workout de Strava). Cyril avait déjà importé son
  archive avec la v0.2 : il doit la **réimporter une fois** pour que ses
  séances de musculation quittent « Entraînement » (pas de doublon).
- **Sauvegarde / export des sorties** : proposée, Cyril a répondu « la
  sauvegarde est déjà sur l'appli » (les données ne sont pourtant que
  dans Chrome du téléphone). Ne pas insister, en reparler à l'étape 3.
- **Étape 2 (détail) : FAITE le 4 nov. 2026** (v0.4.0). Toucher une sortie
  ouvre sa page (#sortie=id). Courbes : altitude, vitesse, puissance, FC,
  cadence (moyenne par colonne, 300 colonnes) ; curseur commun + point sur
  la carte. Zones Coggan (7) avec la FTP de l'appli ; zones FC (5) en % de
  FC max (par défaut la plus haute relevée). IF/TSS : ceux du compteur si
  même FTP, sinon TSS = durée × IF² / 36. FTP par défaut 236 W (choisie
  faute de réponse de Cyril ; réglable). Estimation : 95 % du meilleur
  20 min sur 42 jours. Testé sur données fabriquées seulement.
- **Lire les sorties directement sur le BiNavi** (sans Gadgetbridge ni
  zip) : possible via Web Bluetooth (Chrome Android), en transposant le
  protocole iGPSport décodé par Gadgetbridge (code libre, AGPL ; dépôt
  sur codeberg.org, inaccessible depuis l'environnement de Claude).
  Limites : une seule appli connectée au compteur à la fois, choix du
  compteur dans une liste à chaque synchro (reconnexion auto seulement
  via `chrome://flags`), tests uniquement avec le compteur de Cyril.
  Conseillé comme « étape 6 », après les étapes 2 à 4.
- **FTP** : 236 W par défaut dans l'appli (valeur du compteur) ; Cyril
  peut la changer ou l'estimer dans Réglages.

Montre **Amazfit Active 3 Premium** (étape 5) : « Highly supported » par
Gadgetbridge, mais l'appairage demande une clé d'authentification
récupérée via l'appli Zepp (procédure « Huami/Xiaomi server pairing »).

Projet voisin : **Suivi-direct** (suivi en direct pour la femme de
Cyril, appli Flutter + page web), dépôt séparé.

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
- Avant de dire que c'est fait : `node tests/test-fit.mjs` et
  `node tests/test-navigateur.cjs`, puis regarder les captures.
- Depuis l'environnement de Claude, seuls npm, pip et GitHub sont
  joignables : pas de tuiles OSM, pas de github.io, pas de codeberg. L'API
  GitHub publique répond (sans connexion, 60 requêtes/heure).
