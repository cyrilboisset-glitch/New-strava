// Tests de l'import de l'archive Strava (CSV, dates, GPX, TCX, calculs).
// Données fabriquées : pas besoin de vraies sorties.
// Lancer depuis la racine du dépôt : node tests/test-strava.mjs
import { lireCsv, dateStrava, lireActivitesCsv, typeStrava, resumerSansTrace } from '../js/strava.js';
import { lireGpx, lireTcx, resumerTrace, puissanceNormalisee } from '../js/trace.js';
import { familleSortie } from '../js/sortie.js';
import { fauxGpx, fauxTcx, CSV_STRAVA } from './fausse-archive.mjs';

let echecs = 0;
const verif = (nom, ok, info = '') => { console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : ' — ' + info}`); if (!ok) echecs++; };
const egal = (nom, obtenu, attendu) => verif(nom, JSON.stringify(obtenu) === JSON.stringify(attendu), `obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`);

// CSV : guillemets, virgules et retours à la ligne dans un champ
egal('CSV avec champ sur deux lignes', lireCsv('a,b,c\r\n1,"x, ""y""\nz",3\n'), [['a', 'b', 'c'], ['1', 'x, "y"\nz', '3']]);

// Dates du CSV (UTC)
egal('date anglaise matin', dateStrava('Oct 12, 2026, 8:36:11 AM'), Date.UTC(2026, 9, 12, 8, 36, 11));
egal('date anglaise après-midi', dateStrava('Mar 3, 2025, 6:15:00 PM'), Date.UTC(2025, 2, 3, 18, 15, 0));
egal('date anglaise minuit', dateStrava('Jan 1, 2025, 12:05:00 AM'), Date.UTC(2025, 0, 1, 0, 5, 0));
egal('date française', dateStrava('12 oct. 2026, 08:36:11'), Date.UTC(2026, 9, 12, 8, 36, 11));
egal('date française février', dateStrava('3 févr. 2025, 18:15:00'), Date.UTC(2025, 1, 3, 18, 15, 0));
egal('date française août', dateStrava('15 août 2024, 07:00:00'), Date.UTC(2024, 7, 15, 7, 0, 0));
egal('date illisible', dateStrava('n’importe quoi'), null);

// Types
egal('Ride', typeStrava('Ride').nomSport, 'Vélo');
egal('Virtual Ride', typeStrava('Virtual Ride'), { sport: 2, sousSport: 58, nomSport: 'Vélo virtuel' });
egal('Gravel Ride', typeStrava('Gravel Ride').nomSport, 'Gravel');
egal('Course à pied (fr)', typeStrava('Course à pied').sport, 1);
egal('Weight Training = musculation', typeStrava('Weight Training'), { sport: 10, sousSport: 20, nomSport: 'Musculation' });
egal('Musculation (fr)', typeStrava('Musculation').nomSport, 'Musculation');
egal('Workout = entraînement', typeStrava('Workout'), { sport: 10, sousSport: 0, nomSport: 'Entraînement' });
egal('type inconnu gardé tel quel', typeStrava('Kitesurf').nomSport, 'Kitesurf');

// activities.csv
const csv = lireActivitesCsv(CSV_STRAVA);
egal('lignes avec fichier', [...csv.parFichier.keys()].sort(), ['activities/111.fit.gz', 'activities/222.gpx', 'activities/333.tcx.gz', 'activities/444.gpx']);
const gpx = csv.parFichier.get('activities/222.gpx');
egal('nom et type de la sortie GPX', [gpx.idStrava, gpx.nom, gpx.type], ['222', 'Col du test', 'Ride']);
egal('trois saisies à la main', csv.sansFichier.length, 3);
const manuelle = csv.sansFichier[0];
egal('saisie à la main : chiffres', [manuelle.debut, manuelle.tempsEcouleS, manuelle.tempsMouvementS, manuelle.distanceM, manuelle.denivelePosM],
  [Date.UTC(2025, 2, 3, 18, 15, 0), 3600, 3540, 25000, 0]);
const r = resumerSansTrace(manuelle);
egal('saisie à la main : résumé', [r.id, r.nom, r.nomSport, r.dureeChronoS, r.distanceM, Math.round(r.vitesseMoyMs * 3.6 * 10) / 10],
  ['strava-555', 'Home trainer sans capteur', 'Vélo virtuel', 3540, 25000, 25.4]);

// GPX : 1 h à 30 km/h plein nord, 200 W, 140 bpm, +1 m toutes les 10 s pendant 30 min
const g = lireGpx(fauxGpx());
egal('GPX : points lus', g.records.length, 3601);
egal('GPX : extensions lues', [g.records[5].fc, g.records[5].cadence, g.records[5].puissanceW, g.records[5].altitudeM], [140, 90, 200, 100]);
egal('GPX : type', g.sport, 2);
const rg = resumerTrace(g.records, { id: 'x', nomFichier: 'x.gpx' });
egal('GPX : distance (m)', Math.round(rg.distanceM), 30000);
egal('GPX : durée', [rg.dureeTotaleS, rg.dureeChronoS], [3600, 3600]);
egal('GPX : vitesse (km/h)', Math.round(rg.vitesseMoyMs * 3.6 * 100) / 100, 30);
egal('GPX : D+', rg.denivelePosM, 180);
egal('GPX : puissance moy / NP / max', [rg.puissanceMoyW, rg.puissanceNormW, rg.puissanceMaxW], [200, 200, 200]);
egal('GPX : FC moy / max, cadence', [rg.fcMoy, rg.fcMax, rg.cadenceMoy], [140, 140, 90]);

// Pause de 10 min au milieu : temps en mouvement sans la pause (la seconde
// qui enjambe la pause ne compte pas non plus : 3 599 s)
const avecPause = lireGpx(fauxGpx({ pauseS: 600 }));
const rp = resumerTrace(avecPause.records, { id: 'x', nomFichier: 'x.gpx' });
egal('pause : temps total / en mouvement', [rp.dureeTotaleS, rp.dureeChronoS], [4200, 3599]);
egal('pause : puissance moyenne inchangée', rp.puissanceMoyW, 200);

// NP : 30 min à 100 W puis 30 min à 300 W -> ((100^4 + 300^4)/2)^(1/4) ≈ 253 W (hors transition)
const np = puissanceNormalisee([...Array(1800).fill(100), ...Array(1800).fill(300)]);
verif('NP 100/300 W ≈ 253 W', Math.abs(np - 253) < 2, String(np));

// TCX : 10 min de course à 3 m/s
const t = lireTcx(fauxTcx());
egal('TCX : points et type', [t.records.length, t.sport], [601, 1]);
const rt = resumerTrace(t.records, { id: 'x', nomFichier: 'x.tcx' });
egal('TCX : distance, durée, FC, puissance', [rt.distanceM, rt.dureeChronoS, rt.fcMoy, rt.puissanceMoyW], [1800, 600, 150, 250]);

// Familles pour le tri de la liste
const famille = (sport, sousSport, nomSport = '') => familleSortie({ sport, sousSport, nomSport }).nom;
egal('familles', [famille(2, 7), famille(2, 46), famille(2, 6), famille(21, 0), famille(1, 3), famille(11, 0), famille(10, 20), famille(10, 0), famille(0, 0, 'Kitesurf'), famille(0, 0, 'Activité')],
  ['Vélo', 'Vélo', 'Vélo', 'Vélo', 'Course à pied', 'Marche', 'Musculation', 'Entraînement', 'Kitesurf', 'Autre']);
egal('vélo électrique et vélo : même famille', familleSortie({ sport: 21 }).cle, familleSortie({ sport: 2, sousSport: 7 }).cle);

console.log(`\n${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
