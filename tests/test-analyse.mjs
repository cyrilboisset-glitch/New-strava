// Tests des calculs du détail (efforts, zones, IF/TSS, FTP estimée).
// Valeurs fabriquées et connues d'avance. Lancer : node tests/test-analyse.mjs
import {
  pointsDetail, parSeconde, puissanceNormalisee, meilleursEfforts, intervalleTypiqueS,
  tempsParZone, chargeSortie, estimerFtp, ZONES_PUISSANCE, ZONES_FC,
} from '../js/analyse.js';
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

// Points d'un GPX : 1 h à 30 km/h, 200 W (vitesse absente du fichier : calculée)
const pts = pointsDetail(lireGpx(fauxGpx()).records);
egal('points : nombre et temps final', [pts.length, pts[pts.length - 1].tS], [3601, 3600]);
proche('points : distance finale (m)', pts[pts.length - 1].distanceM, 30000, 0.5);
proche('points : vitesse calculée au milieu (km/h)', pts[1800].vitesseMs * 3.6, 30, 0.01);
egal('points : intervalle typique', intervalleTypiqueS(pts), 1);
const sec = parSeconde(pts, 'puissanceW');
egal('puissance seconde par seconde : 3600 s', sec.length, 3600);
const CINQ = [5, 60, 300, 1200, 3600];
egal('efforts à 200 W constants', meilleursEfforts(sec, CINQ), { 5: 200, 60: 200, 300: 200, 1200: 200, 3600: 200 });
egal('courbe de puissance : 2 h trop long pour 1 h', meilleursEfforts(sec)[7200], null);

// Pause de 10 min : les secondes de la pause ne comptent pas
const ptsPause = pointsDetail(lireGpx(fauxGpx({ pauseS: 600 })).records);
egal('pause : 3599 s de puissance', parSeconde(ptsPause, 'puissanceW').length, 3599);

// Profil connu : 1000 s à 100 W, 1200 s à 300 W, 1400 s à 150 W
const profil = [...Array(1000).fill(100), ...Array(1200).fill(300), ...Array(1400).fill(150)];
egal('efforts du profil', meilleursEfforts(profil, CINQ), { 5: 300, 60: 300, 300: 300, 1200: 300, 3600: 186 });
egal('effort trop long pour la sortie', meilleursEfforts([200, 200, 200], [5]), { 5: null });

// Enregistrement toutes les 8 s (comme le BiNavi) : valeur tenue 8 s
const t0 = Date.UTC(2026, 9, 12, 8, 0, 0);
const toutes8 = Array.from({ length: 76 }, (_, i) => ({ horodatage: new Date(t0 + i * 8000), puissanceW: i < 38 ? 150 : 250 }));
const p8 = pointsDetail(toutes8);
egal('8 s : intervalle typique', intervalleTypiqueS(p8), 8);
egal('8 s : 600 s remplies', parSeconde(p8, 'puissanceW').length, 600);
egal('8 s : meilleure minute', meilleursEfforts(parSeconde(p8, 'puissanceW'), [60])[60], 250);

// NP : 30 min à 100 W puis 30 min à 300 W ≈ 253 W (hors transition)
proche('NP 100/300 W', puissanceNormalisee([...Array(1800).fill(100), ...Array(1800).fill(300)]), 253, 2);

// Zones de puissance avec FTP 236 W : bornes 130, 177, 212, 248, 283, 354
const zp = tempsParZone([0, 130, 131, 177, 178, 212, 213, 248, 249, 283, 284, 354, 355, 600], ZONES_PUISSANCE, 236);
egal('zones de puissance : bornes (W)', zp.map((z) => [z.minV, z.maxV]), [[0, 130], [131, 177], [178, 212], [213, 248], [249, 283], [284, 354], [355, null]]);
egal('zones de puissance : secondes par zone', zp.map((z) => z.secondes), [2, 2, 2, 2, 2, 2, 2]);
// JSON transforme Infinity en null : la dernière borne vaut bien Infinity
egal('zone 7 sans borne haute', zp[6].maxV, Infinity);

const zf = tempsParZone([100, 114, 115, 133, 134, 152, 153, 171, 172, 190], ZONES_FC, 190);
egal('zones FC (FC max 190) : bornes', zf.map((z) => z.maxV).slice(0, 4), [114, 133, 152, 171]);
egal('zones FC : secondes', zf.map((z) => z.secondes), [2, 2, 2, 2, 2]);

// IF et TSS : TSS = durée × IF² / 36
const c1 = chargeSortie({ puissanceNormW: 200, dureeChronoS: 3600 }, 250);
proche('IF 200/250', c1.facteurIntensite, 0.8, 1e-9);
proche('TSS 1 h à IF 0,8 = 64', c1.tss, 64, 1e-9);
egal('même FTP que le compteur : TSS du compteur', chargeSortie({ puissanceNormW: 165, dureeChronoS: 3500, tss: 48, facteurIntensite: 0.7, ftpCompteurW: 236 }, 236),
  { tss: 48, facteurIntensite: 0.7, source: 'compteur' });
const c2 = chargeSortie({ puissanceNormW: 165, dureeChronoS: 3500, tss: 48, ftpCompteurW: 236 }, 225);
egal('autre FTP : recalcul par l\'appli', c2.source, 'appli');
proche('TSS NP 165 W, FTP 225 W, 3500 s', c2.tss, (3500 * (165 / 225) ** 2) / 36, 1e-9);
egal('sans puissance : pas de TSS', chargeSortie({ dureeChronoS: 3600 }, 236).tss, null);

// Estimation de FTP : meilleur 20 min des 42 derniers jours × 95 %
const maintenant = Date.UTC(2026, 10, 4);
const jour = 86400000;
const sorties = [
  { id: 'a', debut: maintenant - 10 * jour, effortsW: { 1200: 240 } },
  { id: 'b', debut: maintenant - 30 * jour, effortsW: { 1200: 252 } },
  { id: 'c', debut: maintenant - 50 * jour, effortsW: { 1200: 300 } }, // trop ancienne
  { id: 'd', debut: maintenant - 5 * jour, effortsW: {} }, // sans puissance
];
const est = estimerFtp(sorties, maintenant);
egal('FTP estimée', [est.ftpW, est.puissance20W, est.sortie.id], [239, 252, 'b']);
egal('rien sur 6 semaines', estimerFtp([sorties[2]], maintenant), null);

console.log(`\n${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
