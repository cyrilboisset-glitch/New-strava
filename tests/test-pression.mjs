// Tests de la pression des pneus : valeurs calculées à la main.
// Lancer : node tests/test-pression.mjs
import { pressionPneus, statsDescente, enPsi, EQUIPEMENT_KG } from '../js/pression-pneus.js';
import { distanceM } from '../js/routage.js';

let echecs = 0;
const proche = (nom, obtenu, attendu, tol) => {
  const ok = Math.abs(obtenu - attendu) <= tol;
  console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : ` — obtenu ${obtenu}, attendu ${attendu} ± ${tol}`}`);
  if (!ok) echecs++;
};
const egal = (nom, obtenu, attendu) => {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  console.log(`${ok ? '✓' : '✗'} ${nom}${ok ? '' : ` — obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`}`);
  if (!ok) echecs++;
};

// 72 kg + 8 kg + 2 kg d'équipement = 82 kg ; 45 % devant : 36,9 kg ; 55 % derrière : 45,1 kg ; 28 mm
// arrière : 71,3 × 45,1 / 784 = 4,10 bar ; avant : 71,3 × 36,9 / 784 = 3,36 bar
const base = { poidsPiloteKg: 72, poidsVeloKg: 8, largeurMm: 28 };
let r = pressionPneus(base);
egal('équipement compté', EQUIPEMENT_KG, 2);
proche('charge totale 82 kg', r.chargeKg, 82, 0.001);
proche('arrière 28 mm : ~4,10 bar', r.arriereBar, 4.1, 0.03);
proche('avant 28 mm : ~3,35 bar', r.avantBar, 3.35, 0.03);
proche('4,10 bar ≈ 59 psi', enPsi(r.arriereBar), 59.5, 0.6);
egal('pas de météo : pas de valeur à gonfler', [r.gonfleAvantBar, r.gonfleArriereBar], [null, null]);

// Pneu plus large : pression plus basse (32 mm : × (28/32)² = 0,766)
proche('32 mm : arrière ~3,15 bar', pressionPneus({ ...base, largeurMm: 32 }).arriereBar, 3.15, 0.03);
proche('25 mm : arrière ~5,15 bar', pressionPneus({ ...base, largeurMm: 25 }).arriereBar, 5.15, 0.04);
// Plus lourd : Cyril 98 kg + 8 + 2 = 108 kg, arrière 59,4 kg : 71,3 × 59,4 / 784 = 5,40 bar
proche('98 kg + vélo 8 kg, 28 mm : arrière ~5,40 bar', pressionPneus({ ...base, poidsPiloteKg: 98 }).arriereBar, 5.4, 0.03);
// Tubeless : × 0,92
proche('tubeless : arrière ~3,75 bar', pressionPneus({ ...base, tubeless: true }).arriereBar, 3.75, 0.04);
// Revêtement
proche('gravel : arrière ~3,20 bar (× 0,78)', pressionPneus({ ...base, revetement: 'chemin' }).arriereBar, 3.2, 0.04);
// Pluie
proche('pluie 0,5 mm : × 0,95', pressionPneus({ ...base, pluieMm: 0.5 }).arriereBar, 3.9, 0.04);
proche('forte pluie 3 mm : × 0,92', pressionPneus({ ...base, pluieMm: 3 }).arriereBar, 3.77, 0.04);
proche('pluie probable sans mm (60 %) : × 0,97', pressionPneus({ ...base, pluiePct: 60 }).arriereBar, 3.98, 0.04);
egal('pas de pluie : aucun facteur', pressionPneus({ ...base, pluiePct: 10, pluieMm: 0 }).facteurs, []);
egal('facteurs listés en %', pressionPneus({ ...base, tubeless: true, pluieMm: 1 }).facteurs.map((f) => f.pct), [-8, -5]);
// Descente raide : le poids passe devant (jusqu'à 50 %)
r = pressionPneus({ ...base, partDescenteRaide: 0.2 });
proche('descentes raides (20 % du trajet) : 50 % devant', r.partAvant, 0.5, 1e-9);
proche('…avant = arrière ~3,73 bar', r.avantBar, 3.75, 0.04);
proche('moitié de la part raide : 47,5 % devant', pressionPneus({ ...base, partDescenteRaide: 0.1 }).partAvant, 0.475, 1e-9);
// Température : gonflé à 20 °C, roulé à 5 °C
// arrière 4,10 bar (5,115 abs) × 293,15 / 278,15 = 5,390 abs = 4,377 bar relatifs, arrondi à 4,40
r = pressionPneus({ ...base, tempC: 5 });
proche('à gonfler à 20 °C pour rouler à 5 °C : arrière ~4,40 bar', r.gonfleArriereBar, 4.4, 0.03);
proche('chaud (35 °C) : on gonfle moins qu\'on ne roule', pressionPneus({ ...base, tempC: 35 }).gonfleArriereBar, 3.85, 0.04);
proche('à 20 °C : même valeur', pressionPneus({ ...base, tempC: 20 }).gonfleArriereBar, pressionPneus(base).arriereBar, 0.051);
// Entrées invalides
egal('poids absent : pas de résultat', pressionPneus({ ...base, poidsVeloKg: 0 }), null);
egal('largeur absurde : pas de résultat', pressionPneus({ ...base, largeurMm: 5 }), null);

// Trajet : environ 1 km de descente à −8 % puis 1 km de plat (un point tous les 70 m)
const pt = (i, alt) => [45 + (i * 70) / 111195, 5, alt];
const coords = [];
for (let i = 0; i <= 15; i++) coords.push(pt(i, 800 - i * 5.6)); // -8 %
for (let i = 16; i <= 30; i++) coords.push(pt(i, 800 - 15 * 5.6)); // plat
const st = statsDescente(coords, distanceM);
proche('descente raide : environ la moitié du trajet', st.partDescenteRaide, 0.5, 0.06);
proche('pente la plus raide ~8 %', st.penteDescenteMaxPct, 8, 0.6);
egal('sans altitude : pas de statistique', statsDescente([[45, 5], [45.001, 5]], distanceM), null);

console.log(`\n${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
