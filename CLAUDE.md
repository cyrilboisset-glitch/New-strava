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
js/reglages.js              Onglet Profil : FTP, FC max, sauvegarde, place utilisée
js/progres.js               Onglet Progrès : bilans, forme / fatigue, records, courbe de puissance
js/stats.js                 Calculs de Progrès (sans navigateur) : périodes, CTL/ATL/TSB, records
js/sauvegarde.js            Export zip (index JSON + fichiers d'origine) et restauration
js/icones.js                Icônes de sport
js/vue3d.js                 Vue 3D (repris de Parcours-3d) : trace 5 m, altitude nettoyée, ruban, survol
js/velos.js                 Vélos (Profil) : liste, km, attribution en lot, choix dans le détail
js/segments-calc.js         Segments (sans navigateur) : découpe, passages interpolés, montées, sprints
js/segments.js              Segments : stockage (réglages segments / passages), recherche, écrans
js/carte-statique.js        Petites cartes : tuiles OSM (Web Mercator) sous le tracé, sans Leaflet
js/parcours.js              Même parcours (trace simplifiée) : comparaison, groupes, classement
js/puissance-estimee.js     Puissance estimée sans capteur (vitesse, pente, masse ; modèle Parcours 3D)
js/routage.js               Création de parcours (sans navigateur) : BRouter, GPX, D+, temps estimé
js/traces.js                Onglet Tracés : carte d'édition, profil, 3D, vent, enregistrer / exporter / partager
js/vent.js                  Vent (repris d'Appli-vent) : Open-Meteo, vent dans l'axe, temps avec le vent, sens, heures
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
tests/test-stats.mjs        Bilans, forme / fatigue, records (TZ=Europe/Paris)
tests/test-vue3d.mjs        Trace 3D : longueur, pentes, curseur, boucle
tests/test-segments.mjs     Segments : temps (aussi à 8 s), sens, écart, détour, tours, montées, sprints
tests/test-vent.mjs         Vent : caps, interpolation, temps avec le vent, sens conseillé, meilleure heure
tests/test-routage.mjs      Tracés : adresse et réponse BRouter, GPX, D+, temps à puissance constante
tests/test-estimation.mjs   Puissance estimée (150 W à plat / 257 W à 1,2 %), même parcours, tuiles
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
- **Étape 3 : FAITE le 4 nov. 2026** (v0.5.0), avec sauvegarde et nouveau
  design demandé par Cyril (« plus appli Strava ») : onglets en bas
  (Sorties, Progrès, Profil), cartes de sortie avec libellés et grand
  aperçu du parcours. Ergonomie inspirée des applis de sport, mais nos
  couleurs et notre nom (pas de copie de la marque Strava).
  Progrès : bilans semaines / mois / années (barres touchables), forme
  (CTL 42 j) / fatigue (ATL 7 j) / fraîcheur (TSB = veille), records et
  courbe de puissance (efforts recalculés une fois pour toutes les
  sorties : VERSION_EFFORTS). Sauvegarde : Profil → Exporter (zip dans
  Téléchargements) ; restauration par « Importer un fichier ».
  Attention : la classe CSS `.barre` est la barre du haut (ne pas la
  réutiliser ; les barres du bilan sont `.bilan-barre`).
- **Étape 2 (détail) : FAITE le 4 nov. 2026** (v0.4.0). Toucher une sortie
  ouvre sa page (#sortie=id). Courbes : altitude, vitesse, puissance, FC,
  cadence (moyenne par colonne, 300 colonnes) ; curseur commun + point sur
  la carte. Zones Coggan (7) avec la FTP de l'appli ; zones FC (5) en % de
  FC max (par défaut la plus haute relevée). IF/TSS : ceux du compteur si
  même FTP, sinon TSS = durée × IF² / 36. FTP par défaut 236 W (choisie
  faute de réponse de Cyril ; réglable). Estimation : 95 % du meilleur
  20 min sur 42 jours. Testé sur données fabriquées seulement.
- **4 nov. 2026, v0.6.0** : Forme/fatigue par année civile ; poids (98 kg
  par défaut, réglable) et W/kg ; vélos saisis dans Profil (`js/velos.js`,
  réglage `velos`, champ `veloId` des sorties), km d'avant l'appli, vélo
  par défaut sur les nouvelles sorties vélo (pas sur l'archive Strava),
  attribution en lot du matériel Strava (colonne « Activity Gear »,
  champ `materielStrava` ; réimporter l'archive pour les sorties déjà
  importées) et des sorties vélo sans vélo.
- **Vue 3D : FAITE le 4 nov. 2026** (v0.7.0). Bascule Carte / 3D dans le
  détail ; ruban coloré selon la pente, gestes, ◎, rotation auto, relief
  (auto, ×1 à ×3), survol, plein écran ; curseur relié aux courbes dans les
  deux sens ; altitude des courbes colorée selon la pente. Différence avec
  Parcours-3d : 111 195 m par degré (au lieu de 110 574) pour que les km de
  la 3D collent aux distances de l'appli. Pas de vue de dessus séparée (la
  carte Leaflet la remplace) ni de secteurs (étape suivante).
- **Segments : FAITS le 4 nov. 2026** (v0.8.0), « comme Strava » (demande
  de Cyril, à la place des « secteurs » d'une seule sortie). Création :
  « Suivre » une montée détectée (critères Parcours 3D) ou un sprint
  (points ≥ 150 % FTP pendant ≥ 5 s), ou à la main (Départ ici / Arrivée
  ici au curseur). Passage = trace à ≤ 30 m du départ puis de l'arrivée,
  ≤ 40 m du tracé en chemin, longueur 0,8–1,3 × ; heures interpolées sur
  la trace ; temps écoulé (pauses comprises, comme Strava). Recherche :
  nouveaux segments dans toutes les sorties (pré-tri par la trace
  simplifiée), nouvelles sorties contre tous les segments (champ
  `segmentsVerifies`, segment.analyseFaite) ; reprise si l'appli est fermée.
  Page #segment=id : record, historique par date / par temps, rang.
  Progrès : « Mes segments ». Inclus dans la sauvegarde.
- **Nouvel accueil : FAIT le 4 nov. 2026** (v0.9.0). Deux menus en haut de
  la liste : « Activité » (select natif `#choix-activite`, nombre de
  sorties par famille) et « Synchro » (bouton `#btn-menu-synchro`, panneau
  `#menu-synchro` : état, Synchroniser maintenant, Choisir / Changer de
  dossier, Importer un fichier, Restaurer une sauvegarde). La carte de
  synchro et la rangée de boutons de tri de l'accueil n'existent plus
  (les boutons de tri restent dans Progrès).
- **Transitions : FAITES le 4 nov. 2026** (v0.9.1). `animer(element,
  classe)` dans app.js : entree-droite (page suivante), entree-gauche
  (retour, repéré par un numéro dans history.state), entree-fondu (onglets,
  liste filtrée, Carte/3D) ; menu Synchro en fondu + zoom (classe `ouvert`,
  caché 200 ms après la fermeture) ; barres du bilan qui poussent ; toast
  qui glisse. Tout est coupé avec prefers-reduced-motion.
  v0.9.2 (Cyril : « ça merde un peu », « plus animé ») : pages avec les
  View Transitions de Chrome (`document.startViewTransition`, data-sens
  avant / retour / onglet sur <html>, `data-transition` pendant le
  glissement ; onglets nommés pour rester fixes, la barre du haut glisse
  avec sa page) ; menu et cartes en cascade ; ruban 3D opaque (Cyril :
  la transparence était illisible).
- **v0.10.0 (4 nov. 2026)**, demandes de Cyril : 1) aperçus des sorties et
  segments sur fond OpenStreetMap (`htmlCarteStatique`, tuiles assombries en
  thème sombre, comme la carte Leaflet du détail) ; 2) sorties identiques
  comparées automatiquement (`memeParcours` : départs et arrivées ≤ 200 m,
  distance ±6 %, 90 % des points à ≤ 150 m dans les deux sens, même
  famille), classement au temps en mouvement : bloc « Même parcours » du
  détail, « Mes parcours » dans Progrès ; 3) puissance estimée pour les
  sorties vélo dehors sans capteur (98 kg + 8 kg, CdA 0,32, Crr 0,004,
  rendement 0,97, ρ 1,2, sans vent), champ `puissanceEstimee` {moyW, normW,
  v, poidsKg} calculé en arrière-plan (recalcul si le poids change), utilisé
  pour IF / TSS / forme (source 'estimee'), affiché « ≈ … estimée », jamais
  dans les records. Sanity check : sortie du 12 oct. (15,6 km, 58 min,
  323 m D+, 98 kg) donne ≈ 136 W de moyenne au calcul à la main, comme le
  capteur (136 W) — à confirmer sur le vrai fichier.
- **Suite demandée le 4 nov. 2026 (dans cet ordre)** : 2) vue 3D dans le
  détail, reprise de l'appli de Cyril `cyrilboisset-glitch/Parcours-3d`
  (index.html, ruban sur toile 2D, profil, vue de dessus, curseur, survol ;
  ne pas modifier ce dépôt) ; 3) secteurs auto (montée / plat / descente
  comme `sectorize` de Parcours-3d, + sprints sur pics de puissance,
  seuil ~150 % FTP, réglable) et manuels (début / fin choisis, nommés),
  avec les vraies données (temps, W, NP, FC, VAM, W/kg). Noms des cols :
  pas de requête réseau sans accord de Cyril (« Montée du km X »).
- **Étape 4 (création de parcours GPX) : FAITE le 5 nov. 2026** (v0.11.0).
  Onglet « Tracés » (#traces) : toucher la carte pour placer les points
  (glisser = déplacer, toucher = retirer), itinéraire BRouter en ligne
  (`https://brouter.de/brouter`, profils fastbike / trekking / safety, ou
  « ligne droite » sans réseau ; seuls les points placés sont envoyés),
  boucle, inverser, ma position ; distance, D+, pente max (100 m), temps
  estimé à puissance constante (150 W par défaut, réglage
  `puissanceParcoursW`, même modèle physique, descentes ≤ 60 km/h) ;
  profil coloré + curseur, 3D ; enregistrer (réglages `traces` + `trace:<id>`,
  inclus dans la sauvegarde), exporter GPX, partager (Web Share).
  Envoi au BiNavi NON vérifié : la copie GitHub de Gadgetbridge (déc. 2024)
  n'a pas encore iGPSport ; l'envoi de GPX n'y existe que pour Garmin et
  Zepp OS. Demander à Cyril d'essayer « Partager » vers Gadgetbridge, sinon
  appli iGPSport ou câble USB. BRouter non joignable depuis l'environnement
  de Claude : testé avec une fausse réponse (CORS supposé ouvert).
- **Liste des tâches à faire (demandée par Cyril le 4 nov. 2026), dans
  l'ordre, après l'étape 4 (création de parcours GPX)** — ne rien
  commencer sans son accord :
  (Synchro Zepp pour la musculation : RETIRÉE le 4 nov. 2026 à la demande
  de Cyril, il ramènera ses séances de musculation à la main, **en
  important un fichier exporté depuis Zepp**. Format à vérifier sur un
  exemple fourni par Cyril avant de coder : export d'une séance (partage
  depuis l'appli Zepp) ou export du compte Zepp (zip de CSV) ; ne pas
  supposer le format.)
  1. **Choix des muscles avec un mannequin**, identique à l'appli de Cyril
     `cyrilboisset-glitch/Musculation-appli` (reprendre, ne pas modifier
     ce dépôt).
  2. **Synchro des activités de l'appli « faux Zwift »**
     (`cyrilboisset-glitch/Zwift`) : voir comment elle enregistre ses
     séances (FIT, GPX…). Ne jamais modifier le dépôt Zwift.
  3. **Changer la nature d'une activité** (vélo, marche, musculation…), en
     recalculant ce qui en dépend (tri, totaux, vélo, puissance estimée).
  4. **Conseil de sens et d'heure selon le vent : FAIT le 5 nov. 2026**
     (v0.12.0, demandé par Cyril : « merge l'appli sens du vent ») dans
     l'onglet Tracés. Moteur d'Appli-vent traduit dans `js/vent.js`
     (Open-Meteo sans clé, ~30 points du tracé envoyés ; 70 % du vent à
     10 m ; sens = vent dans le dos sur le dernier tiers, égalité < 1,5 km/h
     -> ensemble ; puissance +30 % en montée, roue libre à -6 %, 50 km/h
     maxi, densité de l'air) ; jour (7 jours), départs de 6 h à 20 h,
     meilleure heure = plus courte avec le vent parmi celles sans pluie
     probable (< 50 %) ; « mettre le tracé dans ce sens » (inverse la
     géométrie sans recalcul) ; case « Couleurs du vent » sur la 3D
     (`vue3d.colorer`, rouge face -> gris travers -> bleu dos). Open-Meteo
     injoignable depuis l'environnement de Claude : testé avec une fausse
     réponse. Reste à faire de la tâche : la bibliothèque de traces GPX
     (import de GPX existants), températures / tenue d'Appli-vent non reprises.
  5. **Fusion de Cycling Coach** (`cyrilboisset-glitch/Velo-coach`) et
     **envoi du suivi GPS en direct** pendant la sortie (pas un rapport).
     Lien probable avec le projet Suivi-direct (appli Flutter + page web
     pour la femme de Cyril). Limite : une appli web n'envoie plus la
     position écran éteint sur Android ; l'envoi fiable reste dans
     l'appli Flutter. À préciser avec Cyril : qui suit, d'où part la
     position.
  6. **Segments en 3D** : afficher les segments sur la vue 3D (début et
     fin marqués sur le ruban, segment choisi mis en valeur, cadrage et
     survol du segment, comme l'examen détaillé de Parcours 3D).
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

## Mise en ligne : en cas de souci

Si le téléphone ne se met pas à jour après une fusion, vérifier la mise en
ligne : `https://api.github.com/repos/cyrilboisset-glitch/New-strava/actions/runs?per_page=3`
(« pages build and deployment »). Le 4 nov. 2026, l'étape « Deploy to
GitHub Pages » a échoué côté GitHub (« Failed to get ID Token », Request
timeout) et la relance est restée bloquée en file d'attente : une nouvelle
fusion dans `main` relance une mise en ligne complète.

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
