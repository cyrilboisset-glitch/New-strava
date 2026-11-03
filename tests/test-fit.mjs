// Compare le lecteur FIT de l'appli avec les valeurs de référence
// extraites par fitparse (Python). Lancer : node tests/test-fit.mjs
// Les fichiers de tests/donnees/ sont des sorties réelles : ils ne sont
// pas versionnés (voir .gitignore).
import { readFileSync, readdirSync } from 'node:fs';
import { lireFit, equilibreGauchePct16, equilibreGauchePct8 } from '../js/fit.js';
import { resumerSortie } from '../js/sortie.js';

const DOSSIER = new URL('./donnees/', import.meta.url);
const SEMI = 180 / 2 ** 31;
let erreurs = 0;
let verifs = 0;

function egal(nom, obtenu, attendu, tolerance = 1e-6) {
  verifs++;
  const ok = (obtenu === attendu) ||
    (typeof obtenu === 'number' && typeof attendu === 'number' && Math.abs(obtenu - attendu) <= tolerance) ||
    (obtenu == null && attendu == null);
  if (!ok) { erreurs++; if (erreurs < 30) console.log(`  ✗ ${nom} : obtenu ${obtenu}, attendu ${attendu}`); }
}

const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith('.fit'));
if (!fichiers.length) { console.log('Aucun fichier dans tests/donnees/ : rien à tester.'); process.exit(0); }

for (const f of fichiers) {
  console.log(`\n${f}`);
  const octets = readFileSync(new URL(f, DOSSIER));
  const tampon = octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength);
  const ref = JSON.parse(readFileSync(new URL(f.replace(/\.fit$/, '.ref.json'), DOSSIER), 'utf8'));
  const fit = lireFit(tampon);

  // En-tête seul
  const entete = lireFit(tampon, { seulementEntete: true });
  egal('fileId.type (entête seule)', entete.fileId.type, 4);
  egal('records non lus (entête seule)', entete.records.length, 0);

  // Points
  egal('nombre de points', fit.records.length, ref.records.length);
  fit.records.forEach((r, i) => {
    const e = ref.records[i];
    egal(`#${i} temps`, r.horodatage.getTime() / 1000, e.t);
    egal(`#${i} lat`, r.lat, e.lat * SEMI);
    egal(`#${i} lon`, r.lon, e.lon * SEMI);
    egal(`#${i} altitude`, r.altitudeM, e.alt, 1e-3);
    egal(`#${i} fc`, r.fc, e.hr);
    egal(`#${i} cadence`, r.cadence, e.cad);
    egal(`#${i} distance`, r.distanceM, e.dist, 1e-3);
    egal(`#${i} vitesse`, r.vitesseMs, e.spd, 1e-3);
    egal(`#${i} puissance`, r.puissanceW, e.pw);
    egal(`#${i} température`, r.temperature, e.temp);
    egal(`#${i} équilibre brut`, r.equilibreGD, e.lrb);
  });

  // Session
  const s = fit.session;
  const rs = ref.session;
  egal('durée chrono', s.dureeChronoS, rs.total_timer_time);
  egal('durée totale', s.dureeTotaleS, rs.total_elapsed_time);
  egal('distance', s.distanceM, rs.total_distance, 1e-3);
  egal('D+', s.denivelePosM, rs.total_ascent);
  egal('puissance moy', s.puissanceMoyW, rs.avg_power);
  egal('puissance max', s.puissanceMaxW, rs.max_power);
  egal('NP', s.puissanceNormW, rs.normalized_power);
  egal('TSS', s.tss, rs.training_stress_score, 1e-9);
  egal('IF', s.facteurIntensite, rs.intensity_factor, 1e-9);
  egal('FC moy', s.fcMoy, rs.avg_heart_rate);
  egal('FC max', s.fcMax, rs.max_heart_rate);
  egal('calories', s.calories, rs.total_calories);
  egal('début', s.debut.getTime(), new Date(rs.start_time + 'Z').getTime());
  egal('FTP du compteur', fit.zones?.ftpW, ref.ftp);
  egal('nombre de tours', fit.laps.length, ref.laps.length);

  // Décodage de l'équilibre gauche/droite
  egal('équilibre 16 bits', equilibreGauchePct16(0x8000 | 4885), 51.15, 1e-9);
  egal('équilibre 8 bits', equilibreGauchePct8(0x80 | 50), 50);

  // Résumé utilisé par la liste
  const resume = resumerSortie(fit, f);
  egal('résumé : distance km', Math.round(resume.distanceM / 100) / 10, 15.6);
  egal('résumé : D+', resume.denivelePosM, 323);
  egal('résumé : FTP', resume.ftpCompteurW, 236);
  egal('résumé : identifiant stable', resume.id, resumerSortie(lireFit(tampon), 'autre-nom.fit').id);
  verifs++;
  if (!(resume.trace.length >= 20 && resume.trace.length <= 81)) { erreurs++; console.log('  ✗ trace simplifiée', resume.trace.length); }
}

console.log(`\n${verifs} vérifications, ${erreurs} erreur(s)`);
process.exit(erreurs ? 1 : 0);
