// Tests : puissance estimée, sorties sur le même parcours, petites cartes.
// Valeurs calculées à la main. Lancer : node tests/test-estimation.mjs
import { estimerPuissance, estimationPossible } from '../js/puissance-estimee.js';
import { memeParcours, memeParcoursQue, regrouperParcours } from '../js/parcours.js';
import { versPixels, cadrer, tuiles } from '../js/carte-statique.js';
import { pointsDetail, parSeconde, puissanceNormalisee } from '../js/analyse.js';
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

// ---- Puissance estimée -----------------------------------------------------
// Sortie fabriquée : 30 km/h ; +1 m toutes les 10 s pendant 30 min (1,2 %), puis plat.
// Masse 98 + 8 kg, CdA 0,32, Crr 0,004, rendement 0,97 :
//   plat : (106 × 9,81 × 0,004 × 8,333 + 0,5 × 1,2 × 0,32 × 8,333³) / 0,97 = 150,3 W
//   à 1,2 % : + 106 × 9,81 × 0,012 × 8,333, soit 257,5 W
const pts = pointsDetail(lireGpx(fauxGpx()).records);
const w = estimerPuissance(pts, 98);
const moyMontee = w.slice(300, 1500).reduce((x, v) => x + v, 0) / 1200;
proche('montée à 1,2 % : 257 W (moyenne)', moyMontee, 257.5, 4);
proche('plat à 30 km/h : 150 W', w[2700], 150.3, 3);
pts.forEach((p, i) => { p.puissanceEstimeeW = w[i]; });
const sec = parSeconde(pts, 'puissanceEstimeeW');
proche('moyenne sur la sortie ≈ (257 + 150) / 2', sec.reduce((a, v) => a + v, 0) / sec.length, (257.5 + 150.3) / 2, 6);
proche('NP plausible (entre moyenne et maxi)', puissanceNormalisee(sec), 215, 15);
// Arrêt : 0 W ; plus lourd : plus de watts en montée
// 100 s à 30 km/h puis 100 s arrêté au même endroit
const arret = pointsDetail(Array.from({ length: 201 }, (_, s) => ({ horodatage: new Date(1e12 + s * 1000), lat: 45 + (Math.min(s, 100) * 8.333) / 111195, lon: 5, altitudeM: 200 })));
egal('à l\'arrêt : 0 W', estimerPuissance(arret, 98)[180], 0);
egal('80 kg : moins de watts en montée', estimerPuissance(pts, 80)[900] < w[900], true);
// Descente : roue libre (0 W)
const desc = pointsDetail(Array.from({ length: 200 }, (_, s) => ({ horodatage: new Date(1e12 + s * 1000), lat: 45 + (s * 10) / 111195, lon: 5, altitudeM: 1000 - s * 1 })));
egal('descente à 10 % : 0 W (roue libre)', estimerPuissance(desc, 98)[100], 0);
egal('estimation : vélo dehors sans capteur', [
  estimationPossible({ sport: 2, sousSport: 7, trace: [[45, 5], [45.1, 5]] }),
  estimationPossible({ sport: 2, sousSport: 6, trace: [[45, 5], [45.1, 5]] }),
  estimationPossible({ sport: 2, sousSport: 7, puissanceMoyW: 150, trace: [[45, 5], [45.1, 5]] }),
  estimationPossible({ sport: 1, trace: [[45, 5], [45.1, 5]] }),
], [true, false, false, false]);

// ---- Même parcours ---------------------------------------------------------
const M = 111195;
// Boucle : carré de 5 km de côté (20 km), points tous les 100 m ; décalage en m, sens
function boucle({ decalEstM = 0, sens = 1, cote = 5000, id, dureeS = 2400, debut = 0 }) {
  const tr = [];
  const kx = M * Math.cos((45 * Math.PI) / 180);
  for (let d = 0; d <= 4 * cote; d += 100) {
    const k = Math.floor(d / cote); const r = d % cote;
    const [x, y] = [[r, 0], [cote, r], [cote - r, cote], [0, cote - r], [0, 0]][Math.min(k, 4)];
    tr.push([45 + y / M, 5 + (x + decalEstM) / kx]);
  }
  const t = sens > 0 ? tr : [...tr].reverse();
  return { id, sport: 2, sousSport: 7, distanceM: 4 * cote, dureeChronoS: dureeS, debut, trace: t };
}
const a = boucle({ id: 'a', dureeS: 2400 });
const b = boucle({ id: 'b', decalEstM: 40, dureeS: 2300, debut: 1 }); // GPS décalé de 40 m
const c = boucle({ id: 'c', dureeS: 2500, debut: 2 });
const autreSens = boucle({ id: 'inv', sens: -1 });
const plusGrand = boucle({ id: 'grand', cote: 6000 });
const decale = boucle({ id: 'loin', decalEstM: 1000 });
egal('même boucle, GPS décalé de 40 m : même parcours', memeParcours(a, b), true);
egal('boucle plus grande : autre parcours', memeParcours(a, plusGrand), false);
egal('même forme 1 km plus loin : autre parcours', memeParcours(a, decale), false);
egal('marche sur le même tracé : pas comparée au vélo', memeParcours(a, { ...b, sport: 11, sousSport: 0 }), false);
// Sens inverse : départ et arrivée identiques (boucle) et tracé commun -> même parcours ?
// Le tracé est le même, seul le sens change : on le compte comme le même parcours.
egal('boucle en sens inverse : même tracé', memeParcours(a, autreSens), true);
const classement = memeParcoursQue(a, [b, c, plusGrand, decale]);
egal('classement au temps en mouvement', classement.map((s) => s.id), ['b', 'a', 'c']);
const groupes = regrouperParcours([a, b, c, plusGrand, decale, boucle({ id: 'grand2', cote: 6000, dureeS: 2900 })]);
egal('groupes de parcours', groupes.map((g) => g.map((s) => s.id)), [['b', 'a', 'c'], ['grand2', 'grand']].map((g, i) => (i ? ['grand', 'grand2'].sort((x, y) => (x === 'grand' ? 2400 : 2900) - (y === 'grand' ? 2400 : 2900)) : g)));

// ---- Petites cartes ---------------------------------------------------------
const [px, py] = versPixels(45.1885, 5.7245, 12);
egal('Grenoble au zoom 12 : tuile 2113 / 1470', [Math.floor(px / 256), Math.floor(py / 256)], [2113, 1470]);
const cadre = cadrer(a.trace, 320, 150);
const xs = cadre.points.map((p) => p[0]); const ys = cadre.points.map((p) => p[1]);
egal('le tracé tient dans l\'aperçu', Math.min(...xs) >= 17 && Math.max(...xs) <= 303 && Math.min(...ys) >= 17 && Math.max(...ys) <= 133, true);
// 5 km à 27 m par pixel (zoom 12, latitude 45°) = 185 px : trop haut pour 150 px -> zoom 11
egal('zoom adapté (boucle de 5 km de côté)', cadre.z, 11);
const ts = tuiles(cadre, 320, 150);
egal('tuiles qui couvrent tout l\'aperçu', ts.every((t) => t.gauche < 320 && t.gauche + 256 > 0 && t.haut < 150 && t.haut + 256 > 0) && ts.length >= 2 && ts.length <= 6, true);

console.log(`\n${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
