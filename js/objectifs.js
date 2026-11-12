// Objectifs : anneaux (arc rouge = fait, arc bleu = prévu à ce jour), partagés entre
// la page Progrès (gestion) et le bandeau de l'accueil (coup d'œil, à faire glisser).
import { avancementObjectif, TYPES_OBJECTIF, PERIODES_OBJECTIF } from './stats.js';
import { familleSortie } from './sortie.js';
import { nombre, duree, echapper } from './format.js';

export const UNITES_OBJECTIF = { distance: 'km', denivele: 'm', ftp: 'W', seances: 'séances', tempsmuscu: 'h' };
export const OBJECTIFS_MUSCU = ['seances', 'tempsmuscu'];

/** Les sorties qui comptent pour cet objectif : vélo, ou séances de musculation */
export function sortiesObjectif(type, toutes) {
  const cle = OBJECTIFS_MUSCU.includes(type) ? 'musculation' : 'sport-2';
  return toutes.filter((s) => familleSortie(s).cle === cle);
}

export function valeurObjectif(type, v) {
  if (type === 'distance') return `${nombre(v, v > 0 && v < 100 ? 1 : 0)} km`;
  if (type === 'denivele') return `${nombre(v)} m`;
  if (type === 'seances') { const n = Number.isInteger(v) ? v : Math.round(v * 10) / 10; return `${nombre(n, Number.isInteger(n) ? 0 : 1)} séance${n >= 2 ? 's' : ''}`; }
  if (type === 'tempsmuscu') return duree(v * 3600);
  return `${nombre(v)} W`;
}

/** Même chose en plus court, pour le bandeau : « 42 / 100 km » */
function valeurCourte(type, v) {
  if (type === 'seances') return nombre(Number.isInteger(v) ? v : Math.round(v * 10) / 10, Number.isInteger(v) ? 0 : 1);
  if (type === 'tempsmuscu') return duree(v * 3600);
  return valeurObjectif(type, v).replace(/ (km|m|W)$/, '');
}
const uniteCourte = (type) => ({ distance: ' km', denivele: ' m', ftp: ' W', seances: ' séances', tempsmuscu: '' }[type]);

/**
 * En avance ou en retard sur le rythme régulier (« pile dans le rythme » compte comme en avance) ;
 * objectif atteint ou dépassé = « atteint » (anneau doré).
 * @returns {'atteint' | 'avance' | 'retard'}
 */
export function etatAvancement(a) {
  if (a.fait >= a.cible) return 'atteint';
  if (a.ecart == null) return 'avance';
  return a.ecart >= -a.cible * 0.005 ? 'avance' : 'retard';
}

// Anneau : arc extérieur = où j'en suis (doré si l'objectif est atteint ou dépassé, vert en avance, rouge en retard), arc intérieur bleu =
// l'objectif, c'est-à-dire où je devrais en être à ce jour. Les arcs se remplissent à
// l'affichage (animation CSS sur stroke-dasharray, coupée si Android demande moins d'animations).
export function anneau(partFait, partAttendu, etat = 'avance') {
  const arc = (r, part, classe) => {
    const c = 2 * Math.PI * r;
    const l = Math.max(0, Math.min(1, part)) * c;
    return `<circle class="anneau-fond" cx="60" cy="60" r="${r}"/>${l > 0.5 ? `<circle class="${classe}" cx="60" cy="60" r="${r}" stroke-dasharray="${l.toFixed(2)} ${c.toFixed(2)}" style="--c:${c.toFixed(2)}" transform="rotate(-90 60 60)"/>` : ''}`;
  };
  return `<svg class="anneau" viewBox="0 0 120 120" aria-hidden="true">${arc(52, partFait, `anneau-fait ${etat}`)}${partAttendu != null ? arc(39, Math.round(partAttendu * 1000) / 1000, 'anneau-attendu') : ''}</svg>`;
}

const periodeCourte = { semaine: 'semaine', mois: 'mois', annee: 'année' };
const NOM_COURT = { distance: 'Distance', denivele: 'Dénivelé', ftp: 'FTP', seances: 'Séances', tempsmuscu: 'Temps' };

/**
 * Bandeau de l'accueil : une carte ronde par objectif, à faire glisser s'il y en a plus
 * qu'il n'en tient à l'écran. Toucher une carte ouvre Progrès (modification).
 */
export function htmlBandeauObjectifs(objectifs, toutes, profil, maintenantMs = Date.now()) {
  const ordre = (o) => Object.keys(TYPES_OBJECTIF).indexOf(o.type) * 3 + Object.keys(PERIODES_OBJECTIF).indexOf(o.periode);
  const cartes = [...objectifs].sort((a, b) => ordre(a) - ordre(b)).map((o) => {
    const a = avancementObjectif(o, sortiesObjectif(o.type, toutes), maintenantMs, { ftpW: profil?.ftpW });
    const pct = Math.round(a.part * 100);
    const atteint = a.fait >= a.cible;
    const fait = a.fait || o.type !== 'ftp' ? valeurCourte(o.type, a.fait) : '–';
    return `<a class="objectif-mini${atteint ? ' atteint' : ''}" href="#progres" aria-label="${echapper(`${TYPES_OBJECTIF[o.type]}, ${PERIODES_OBJECTIF[o.periode].toLowerCase()} : ${valeurObjectif(o.type, a.fait)} sur ${valeurObjectif(o.type, a.cible)}`)}">
      <span class="objectif-cercle">${anneau(a.part, a.attendu != null ? a.attendu / a.cible : null, etatAvancement(a))}
        <span class="objectif-centre"><b>${pct} %</b></span></span>
      <span class="objectif-mini-nom">${NOM_COURT[o.type]}</span>
      <span class="objectif-mini-sous">${OBJECTIFS_MUSCU.includes(o.type) ? 'muscu · ' : ''}${periodeCourte[o.periode]}</span>
      <span class="objectif-mini-val"><b>${fait}</b> / ${valeurCourte(o.type, a.cible)}${uniteCourte(o.type)}</span>
    </a>`;
  });
  if (!cartes.length) return `<a class="objectif-mini vide" href="#progres"><span class="objectif-plus" aria-hidden="true">+</span><span class="objectif-mini-nom">Créer un objectif</span><span class="objectif-mini-sous">distance, dénivelé, FTP, musculation</span></a>`;
  return cartes.join('');
}
