// Tests de la page Progrès : bilans par période, forme / fatigue, records.
// Valeurs connues d'avance. Lancer : TZ=Europe/Paris node tests/test-stats.mjs
// (les semaines et les mois se comptent en heure locale)
import { bilanPeriodes, formeFatigue, etatFraicheur, records, debutPeriode } from '../js/stats.js';

process.env.TZ = process.env.TZ || 'Europe/Paris';
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
const date = (a, m, j, h = 10) => new Date(a, m - 1, j, h).getTime();

// Périodes : le mercredi 4 nov. 2026 est dans la semaine du lundi 2 nov.
egal('début de semaine (lundi)', new Date(debutPeriode(date(2026, 11, 4), 'semaine')).toDateString(), new Date(2026, 10, 2).toDateString());
egal('début de semaine un dimanche', new Date(debutPeriode(date(2026, 11, 8), 'semaine')).toDateString(), new Date(2026, 10, 2).toDateString());
egal('début de mois', new Date(debutPeriode(date(2026, 11, 4), 'mois')).toDateString(), new Date(2026, 10, 1).toDateString());

const sorties = [
  { debut: date(2026, 11, 2), distanceM: 40000, dureeChronoS: 5400, denivelePosM: 500 }, // lundi, semaine en cours
  { debut: date(2026, 11, 3), distanceM: 20000, dureeChronoS: 2700, denivelePosM: 100 },
  { debut: date(2026, 11, 1, 23), distanceM: 30000, dureeChronoS: 3600, denivelePosM: 300 }, // dimanche 23 h : semaine d'avant
  { debut: date(2026, 10, 12), distanceM: 15600, dureeChronoS: 3480, denivelePosM: 323 },
  { debut: date(2025, 6, 1), distanceM: 30000, dureeChronoS: 3600, denivelePosM: 400 },
];
const maintenant = date(2026, 11, 4, 18);
const semaines = bilanPeriodes(sorties, 'semaine', 12, maintenant);
egal('12 semaines', semaines.length, 12);
const derniere = semaines[11];
egal('semaine en cours : 2 sorties, 60 km, 2 h 15, 600 m', [derniere.n, derniere.distanceM, derniere.dureeS, derniere.denivelePosM], [2, 60000, 8100, 600]);
egal('semaine d\'avant : la sortie du dimanche 23 h', [semaines[10].n, semaines[10].distanceM], [1, 30000]);
const mois = bilanPeriodes(sorties, 'mois', 12, maintenant);
egal('novembre : 2 sorties ; octobre : 1 (le 1er nov. est en novembre)', [mois[11].n, mois[10].n, mois[11].distanceM], [3, 1, 90000]);
egal('juin 2025 hors des 12 derniers mois', mois.reduce((a, p) => a + p.n, 0), 4);
const annees = bilanPeriodes(sorties, 'annee', 0, maintenant);
egal('années depuis la première sortie', annees.map((p) => [new Date(p.debut).getFullYear(), p.n]), [[2025, 1], [2026, 4]]);

// Forme / fatigue : 100 TSS chaque jour pendant 42 jours
// (NP 200 W, FTP 200 W, 1 h -> IF 1, TSS 100)
const jour0 = date(2026, 9, 1, 9);
const quotidien = Array.from({ length: 42 }, (_, i) => ({ debut: jour0 + i * 86400000, puissanceNormW: 200, dureeChronoS: 3600 }));
const ff = formeFatigue(quotidien, 200, jour0 + 41 * 86400000);
egal('42 jours calculés', ff.length, 42);
egal('TSS du jour', ff[0].tss, 100);
// CTL après n jours de charge constante C : C × (1 − (41/42)^n) ; ATL : C × (1 − (6/7)^n)
proche('forme après 42 jours', ff[41].ctl, 100 * (1 - (41 / 42) ** 42), 1e-9);
proche('fatigue après 42 jours', ff[41].atl, 100 * (1 - (6 / 7) ** 42), 1e-9);
proche('fraîcheur = forme − fatigue de la veille', ff[41].tsb, ff[40].ctl - ff[40].atl, 1e-9);
// Repos : la fatigue baisse plus vite que la forme, la fraîcheur remonte
const repos = formeFatigue(quotidien, 200, jour0 + 55 * 86400000);
egal('jours de repos ajoutés', repos.length, 56);
egal('repos : TSS 0', repos[50].tss, 0);
egal('repos : fraîcheur positive après 2 semaines', repos[55].tsb > 0, true);
egal('sorties sans puissance : pas de charge', formeFatigue([{ debut: jour0, dureeChronoS: 3600 }], 200, jour0).map((j) => j.tss), [0]);
egal('états de fraîcheur', [etatFraicheur(30), etatFraicheur(10), etatFraicheur(0), etatFraicheur(-20), etatFraicheur(-40)].map((t) => t.split(' ')[0]),
  ['Très', 'Frais', 'Équilibré', 'Fatigué', 'Très']);

// Records
const avecEfforts = [
  { id: 'a', debut: date(2026, 10, 12), effortsW: { 5: 600, 1200: 230 } },
  { id: 'b', debut: date(2025, 6, 1), effortsW: { 5: 700, 1200: 250 } },
  { id: 'c', debut: date(2026, 11, 1), effortsW: {} },
];
const r = records(avecEfforts, [5, 1200, 3600]);
egal('records de tous les temps', [r[5].w, r[5].sortie.id, r[1200].w, r[3600]], [700, 'b', 250, null]);
const r6 = records(avecEfforts, [5, 1200], date(2026, 9, 1));
egal('records récents', [r6[5].w, r6[1200].sortie.id], [600, 'a']);

console.log(`\n${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
