// Tests de la page Progrès : bilans par période, forme / fatigue, records.
// Valeurs connues d'avance. Lancer : TZ=Europe/Paris node tests/test-stats.mjs
// (les semaines et les mois se comptent en heure locale)
import { bilanPeriodes, formeFatigue, etatFraicheur, records, debutPeriode, avancementObjectif, ftpApresSortie } from '../js/stats.js';

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

// Objectifs : jeudi 5 nov. 2026 à 12 h (Paris) ; semaine du lundi 2 au dimanche 8
const jeudi = new Date(2026, 10, 5, 12).getTime();
const so = [
  { debut: new Date(2026, 10, 3, 9).getTime(), distanceM: 50000, denivelePosM: 600, effortsW: { 1200: 250 } },
  { debut: new Date(2026, 10, 5, 8).getTime(), distanceM: 30000, denivelePosM: 400, effortsW: { 1200: 240 } },
  { debut: new Date(2026, 9, 31, 9).getTime(), distanceM: 40000, denivelePosM: 300 },
  { debut: new Date(2025, 11, 31, 9).getTime(), distanceM: 99000, denivelePosM: 999 },
  { debut: new Date(2026, 10, 6, 9).getTime(), distanceM: 77000 }, // plus tard (pas encore faite)
];
const ds = avancementObjectif({ type: 'distance', periode: 'semaine', cible: 200 }, so, jeudi);
egal('semaine : 80 km faits, 100 attendus à mi-semaine, 20 de retard, reste 120 km, 3,5 jours',
  [ds.fait, Math.round(ds.attendu), Math.round(ds.ecart), ds.reste, ds.joursRestants], [80, 100, -20, 120, 3.5]);
const dm = avancementObjectif({ type: 'denivele', periode: 'mois', cible: 3000 }, so, jeudi);
egal('mois : 1 000 m en novembre (pas le 31 oct.), 15 % du mois écoulé', [dm.fait, Math.round(dm.partEcoulee * 1000) / 1000], [1000, 0.15]);
const da = avancementObjectif({ type: 'distance', periode: 'annee', cible: 5000 }, so, jeudi);
egal('année : 2026 seulement (pas le 31 déc. 2025)', da.fait, 120);
const df = avancementObjectif({ type: 'ftp', periode: 'mois', cible: 250 }, so, jeudi, { ftpW: 230 });
// pas d'effort de 20 min avant novembre : départ = FTP réglée 230 W ; 15 % du mois -> 233 W attendus
egal('FTP : estimée aujourd\'hui (250 W sur 20 min -> 238 W), attendu 233 W depuis la FTP réglée', [df.fait, Math.round(df.attendu), df.reste, df.departFtpW], [238, 233, 12, 230]);
const avant = [...so, { debut: new Date(2026, 9, 20, 9).getTime(), effortsW: { 1200: 220 } }];
egal('FTP : départ = FTP estimée au début du mois (220 W -> 209 W)', avancementObjectif({ type: 'ftp', periode: 'mois', cible: 250 }, avant, jeudi, { ftpW: 230 }).departFtpW, 209);
egal('FTP après chaque sortie : 209 W le 20 oct., 238 W le 3 nov., toujours 238 W le 5 nov. (240 W < 250 W)',
  [ftpApresSortie(avant[5], avant).ftpW, ftpApresSortie(so[0], avant).ftpW, ftpApresSortie(so[1], avant).ftpW], [209, 238, 238]);

// Musculation : séances et temps (la liste donnée ne contient que les séances)
const muscu = [
  { debut: new Date(2026, 10, 2, 18).getTime(), dureeChronoS: 2100 }, // 35 min, lundi
  { debut: new Date(2026, 10, 4, 18).getTime(), dureeChronoS: 1800 }, // 30 min, mercredi
  { debut: new Date(2026, 9, 28, 18).getTime(), dureeChronoS: 3600 }, // octobre
  { debut: new Date(2026, 10, 6, 18).getTime(), dureeChronoS: 3600 }, // pas encore faite
];
const ms = avancementObjectif({ type: 'seances', periode: 'semaine', cible: 3 }, muscu, jeudi);
egal('séances de la semaine : 2 faites sur 3, 1,5 attendues à mi-semaine, reste 1', [ms.fait, ms.attendu, ms.reste, Math.round(ms.part * 100)], [2, 1.5, 1, 67]);
const mm = avancementObjectif({ type: 'seances', periode: 'mois', cible: 10 }, muscu, jeudi);
egal('séances du mois : 2 en novembre (pas celle d\'octobre)', mm.fait, 2);
const mt = avancementObjectif({ type: 'tempsmuscu', periode: 'semaine', cible: 2 }, muscu, jeudi);
proche('temps de muscu de la semaine : 65 min = 1,083 h sur 2 h', mt.fait, 65 / 60, 0.001);
egal('temps de muscu : 54 % de l\'objectif, 1 h attendue à mi-semaine', [Math.round(mt.part * 100), mt.attendu], [54, 1]);

// Couleur de l'anneau : vert en avance (ou pile dans le rythme, ou atteint), rouge en retard
const { etatAvancement } = await import('../js/objectifs.js');
egal('anneau : retard / avance / pile dans le rythme / atteint', [
  etatAvancement(ds), etatAvancement({ fait: 120, cible: 200, ecart: 20 }), etatAvancement({ fait: 99.5, cible: 200, ecart: -0.5 }), etatAvancement({ fait: 210, cible: 200, ecart: -5 }),
], ['retard', 'avance', 'avance', 'avance']);

console.log(`\n${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
