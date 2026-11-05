// Tests des segments : découpe, passages (sens, écart, tours), montées, sprints.
// Traces fabriquées aux valeurs connues. Lancer : node tests/test-segments.mjs
import { decouperSegment, trouverPassages, bboxCompatible, detecterMontees, detecterSprints, classer, recordsParSortie, dejaCouvert } from '../js/segments-calc.js';
import { pointsDetail } from '../js/analyse.js';
import { construireTrace } from '../js/vue3d.js';
import { lireGpx } from '../js/trace.js';
import { fauxGpx } from './fausse-archive.mjs';

let echecs = 0;
const egal = (nom, obtenu, attendu) => {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : ` — obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`}`);
  if (!ok) echecs++;
};
const proche = (nom, obtenu, attendu, tol) => {
  const ok = Math.abs(obtenu - attendu) <= tol;
  console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : ` — obtenu ${obtenu}, attendu ${attendu} ± ${tol}`}`);
  if (!ok) echecs++;
};

const M_PAR_DEG = 111195;
const t0 = Date.UTC(2026, 9, 12, 8);
// Ligne droite plein nord à v (m/s), un point toutes les `pas` s, décalée de `ecartEstM` vers l'est
function ligne({ dureeS = 3600, v = 30 / 3.6, pas = 1, ecartEstM = 0, sens = 1, debut = t0, latDepart = 45, puissance = () => 200 } = {}) {
  const res = [];
  for (let s = 0; s <= dureeS; s += pas) {
    const d = sens > 0 ? s * v : (dureeS - s) * v;
    res.push({ horodatage: new Date(debut + s * 1000), lat: latDepart + d / M_PAR_DEG, lon: 5.5 + ecartEstM / (M_PAR_DEG * Math.cos((45 * Math.PI) / 180)), altitudeM: 200, puissanceW: puissance(s), fc: 140 });
  }
  return pointsDetail(res);
}

// Segment : du km 5 au km 10 de la ligne (à 30 km/h : 5 km en 600 s)
const ref = ligne();
const i5 = ref.findIndex((p) => p.distanceM >= 5000);
const i10 = ref.findIndex((p) => p.distanceM >= 10000);
const seg = decouperSegment(ref, i5, i10);
proche('longueur du segment (m)', seg.distanceM, 5000, 10);
// à 30 km/h et 1 point par seconde (8,3 m), un point gardé tous les 3 : 25 m -> 201 points
egal('un point gardé dès 20 m parcourus', seg.points.length, 201);

const p1 = trouverPassages(seg, ref);
egal('un passage sur la sortie d\'origine', p1.length, 1);
proche('temps : 600 s', p1[0].dureeS, 600, 1);
egal('mesures du passage', [p1[0].puissanceMoyW, p1[0].fcMoy], [200, 140]);
proche('vitesse 30 km/h', p1[0].vitesseMoyMs * 3.6, 30, 0.1);

// Même route enregistrée toutes les 8 s (BiNavi), départ décalé de 3 s : heure interpolée
const p8 = trouverPassages(seg, ligne({ pas: 8, debut: t0 + 3000 }));
egal('8 s : un passage', p8.length, 1);
proche('8 s : temps toujours 600 s (interpolé)', p8[0].dureeS, 600, 1);

// Plus lent : 20 km/h -> 900 s
proche('à 20 km/h : 900 s', trouverPassages(seg, ligne({ v: 20 / 3.6, dureeS: 5400 }))[0].dureeS, 900, 1);
// Écart GPS de 15 m : passage reconnu
egal('trace décalée de 15 m : reconnue', trouverPassages(seg, ligne({ ecartEstM: 15 })).length, 1);
// Route parallèle à 100 m : pas de passage
egal('route parallèle à 100 m : rien', trouverPassages(seg, ligne({ ecartEstM: 100 })).length, 0);
// Sens inverse : pas de passage
egal('sens inverse : rien', trouverPassages(seg, ligne({ sens: -1 })).length, 0);
// Sortie qui s'arrête avant la fin du segment
egal('sortie trop courte : rien', trouverPassages(seg, ligne({ dureeS: 1000 })).length, 0);

// Deux tours : aller jusqu'au km 12, retour au km 0 par une autre route (500 m à l'est), puis de nouveau
const tours = [];
const tour = (debutS) => {
  const aller = ligne({ dureeS: 1440, debut: t0 + debutS * 1000 });
  const retour = ligne({ dureeS: 1440, sens: -1, ecartEstM: 500, debut: t0 + (debutS + 1441) * 1000 });
  return [...aller, ...retour];
};
for (const p of [...tour(0), ...tour(2900)]) tours.push({ horodatage: new Date(t0 + p.tS * 1000), lat: p.lat, lon: p.lon, puissanceW: 200 });
const pTours = trouverPassages(seg, pointsDetail([...tour(0), ...tour(2900)].map((p, k) => ({ horodatage: new Date(t0 + k * 1000), lat: p.lat, lon: p.lon, puissanceW: 200 }))));
egal('deux tours : deux passages', pTours.length, 2);

// Détour : la trace quitte la route au km 7,5 pendant 1 km (300 m à l'est)
const detour = ref.map((p) => ({ horodatage: new Date(t0 + p.tS * 1000), lat: p.lat, lon: p.distanceM > 7000 && p.distanceM < 8000 ? p.lon + 300 / (M_PAR_DEG * Math.cos((45 * Math.PI) / 180)) : p.lon }));
egal('détour au milieu : rien', trouverPassages(seg, pointsDetail(detour)).length, 0);

// Pré-tri par la trace simplifiée de la sortie
egal('pré-tri : même route', bboxCompatible(seg, ref.filter((_, k) => k % 50 === 0).map((p) => [p.lat, p.lon])), true);
egal('pré-tri : autre région', bboxCompatible(seg, [[44, 4], [44.1, 4.1]]), false);

// Classement
const a = { dureeS: 700 }; const b = { dureeS: 600 }; const c = { dureeS: 650 };
const rangs = classer([a, b, c]);
egal('classement par temps', [rangs.get(a), rangs.get(b), rangs.get(c)], [3, 1, 2]);

// Montées : plat 2 km, montée de 3 km à 6 %, plat 2 km
const col = [];
for (let s = 0; s <= 2100; s++) {
  const d = s * (10 / 3.6) * (7000 / 5833); // 7 km en 2100 s
  const alt = d < 2000 ? 300 : d < 5000 ? 300 + (d - 2000) * 0.06 : 480;
  col.push({ horodatage: new Date(t0 + s * 1000), lat: 45 + d / M_PAR_DEG, lon: 5.5, altitudeM: alt });
}
const ptsCol = pointsDetail(col);
const montees = detecterMontees(construireTrace(ptsCol), ptsCol.length);
egal('une montée détectée', montees.length, 1);
proche('longueur de la montée (m)', montees[0].distanceM, 3000, 150);
proche('pente moyenne (%)', montees[0].penteMoyPct, 6, 0.4);
proche('départ de la montée vers le km 2', ptsCol[montees[0].i0].distanceM, 2000, 150);
// Pas de montée sur le plat
egal('ligne plate : pas de montée', detecterMontees(construireTrace(ref), ref.length).length, 0);

// Sprints : 200 W, puis 700 W pendant 15 s à la 1 000e seconde (seuil 354 W)
const sprint = ligne({ puissance: (s) => (s >= 1000 && s < 1015 ? 700 : 200) });
const sp = detecterSprints(sprint, 354);
egal('un sprint détecté', sp.length, 1);
egal('pic du sprint', sp[0].picW, 700);
proche('durée du sprint (s)', sp[0].dureeS, 15, 0);
egal('pas de sprint sous le seuil', detecterSprints(ref, 354).length, 0);

// La sortie de l'archive (GPX) : segment du km 10 au km 20 -> 1 200 s ; avec pause de 10 min au km 15 -> 1 800 s
const gpx = pointsDetail(lireGpx(fauxGpx()).records);
const s1020 = decouperSegment(gpx, gpx.findIndex((p) => p.distanceM >= 10000), gpx.findIndex((p) => p.distanceM >= 20000));
proche('GPX : 1 200 s', trouverPassages(s1020, gpx)[0].dureeS, 1200, 1);
const gpxPause = pointsDetail(lireGpx(fauxGpx({ pauseS: 600 })).records);
proche('GPX avec pause : 1 800 s (temps écoulé, comme Strava)', trouverPassages(s1020, gpxPause)[0].dureeS, 1800, 1);

// Records perso battus : plus rapide que tous les passages d'avant (le premier ne compte pas)
const P = (segmentId, sortieId, jour, dureeS) => ({ segmentId, sortieId, debut: Date.UTC(2026, 0, jour), dureeS });
const recs = recordsParSortie([
  P('a', 's1', 1, 300), P('a', 's2', 2, 290), P('a', 's3', 3, 295), P('a', 's4', 4, 280),
  P('b', 's2', 2, 60), P('b', 's4', 4, 55), P('b', 's3', 3, 60),
]);
egal('records : s2 bat s1 (a), s4 bat s2 (a) et s2 (b), s3 rien, s1 premier passage', [recs.get('s1'), recs.get('s2'), recs.get('s3'), recs.get('s4')], [undefined, 1, undefined, 2]);
egal('records : dans l\'ordre des dates, pas de l\'import', recordsParSortie([P('a', 'x', 5, 200), P('a', 'y', 1, 250)]).get('x'), 1);

// Déjà couvert : au moins la moitié en commun
const pl = Array.from({ length: 101 }, (_, i) => ({ distanceM: i * 10 }));
egal('couvert : même morceau à 50 m près', dejaCouvert({ i0: 20, i1: 60 }, [{ iDebut: 25, iFin: 62 }], pl), true);
egal('pas couvert : morceaux voisins', dejaCouvert({ i0: 20, i1: 40 }, [{ iDebut: 38, iFin: 70 }], pl), false);
egal('pas couvert : petit bout dans un long segment', dejaCouvert({ i0: 50, i1: 55 }, [{ iDebut: 0, iFin: 100 }], pl), false);

console.log(`\n${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
