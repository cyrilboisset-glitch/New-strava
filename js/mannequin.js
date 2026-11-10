// Mannequin des muscles travaillés (style Zepp) : vue de face et de dos, muscle
// principal en rouge, secondaire en orange, non ciblé en gris. On touche une zone
// pour changer son état : aucun -> principal -> secondaire -> aucun.
// Gardé dans la sortie : sortie.muscles = { pecs: 'p', triceps: 's' }.
// Le dessin (SVG à la main) et les états sont testés dans tests/test-mannequin.mjs.
import { completerSortie } from './db.js';
import { echapper } from './format.js';

export const MUSCLES = {
  trapezes: 'Trapèzes', epaules: 'Épaules', pecs: 'Pectoraux', biceps: 'Biceps', triceps: 'Triceps', avantbras: 'Avant-bras',
  abdos: 'Abdominaux', obliques: 'Obliques', dos: 'Dos', lombaires: 'Bas du dos', fessiers: 'Fessiers',
  cuisses: 'Quadriceps', ischios: 'Ischio-jambiers', mollets: 'Mollets',
};
export const ETATS = { p: 'principal', s: 'secondaire' };

/** aucun -> principal -> secondaire -> aucun */
export const etatSuivant = (e) => (e === 'p' ? 's' : e === 's' ? undefined : 'p');

/** Muscles nettoyés : seulement les zones connues, états p / s */
export function nettoyer(muscles) {
  const res = {};
  for (const [m, e] of Object.entries(muscles ?? {})) if (MUSCLES[m] && ETATS[e]) res[m] = e;
  return res;
}

/** « Principaux : Pectoraux · Secondaires : Triceps » ; '' si rien */
export function resumeMuscles(muscles) {
  const m = nettoyer(muscles);
  const liste = (e) => Object.keys(MUSCLES).filter((k) => m[k] === e).map((k) => MUSCLES[k]);
  const p = liste('p'); const s = liste('s');
  return [p.length ? `Principaux : ${p.join(', ')}` : '', s.length ? `Secondaires : ${s.join(', ')}` : ''].filter(Boolean).join(' · ');
}

// ---- Dessin : moitié gauche (x < 100), la droite est son image dans un miroir ----------

const SYM = 'matrix(-1 0 0 1 200 0)';

// Silhouette (remplissage clair, contour gris)
const SIL_CENTRE = '<ellipse cx="100" cy="30" rx="16.5" ry="21"/><rect x="91" y="48" width="18" height="22" rx="6"/>';
const SIL_GAUCHE = [
  // tronc
  'M100 64C86 65 72 70 66 82C64 104 68 140 74 186C72 202 71 214 72 228L100 236Z',
  // bras
  'M65 80C56 80 49 88 47 102C45 128 44 154 40 182C37 200 35 220 34 238L40 250L52 246C56 226 60 202 64 176C66 148 69 122 71 96Z',
  // jambe
  'M100 228L72 226C69 250 70 292 77 322C75 346 75 376 80 402L77 420L98 420L98 402C99 374 101 346 99 322C100 290 100 262 100 228Z',
];

// Zones : { face: [chemins gauche], dos: [chemins gauche] }
const ZONES = {
  trapezes: {
    face: ['M99 64L84 68C88 74 94 78 99 80Z'],
    dos: ['M100 58L84 68C79 78 84 94 92 104L100 124Z'],
  },
  epaules: {
    face: ['M71 70C58 70 49 78 47 94C46 104 50 112 56 114C59 102 65 92 75 86C77 80 76 74 71 70Z'],
    dos: ['M71 70C58 70 49 78 47 94C46 104 50 112 56 114C59 102 65 92 75 86C77 80 76 74 71 70Z'],
  },
  pecs: { face: ['M99 86L76 86C71 94 71 106 77 114C85 120 95 118 99 116Z'] },
  biceps: { face: ['M52 117C48 128 46 140 48 153L63 156C66 143 67 129 64 116Z'] },
  triceps: { dos: ['M52 117C48 128 46 140 48 153L63 156C66 143 67 129 64 116Z'] },
  avantbras: {
    face: ['M49 160C45 178 42 198 41 216L51 218C54 199 58 177 62 161Z'],
    dos: ['M49 160C45 178 42 198 41 216L51 218C54 199 58 177 62 161Z'],
  },
  abdos: { face: ['M99 122L88 122C86 140 86 166 89 190L99 196Z'] },
  obliques: { face: ['M84 122C78 140 77 166 80 190L86 190C84 166 84 142 85 122Z'] },
  dos: { dos: ['M100 126L92 106C80 106 73 114 74 128C76 148 84 164 100 174Z'] },
  lombaires: { dos: ['M100 178C94 176 88 172 85 166C83 178 85 190 90 198L100 200Z'] },
  fessiers: { dos: ['M100 202C86 200 75 204 73 220C75 234 87 242 100 238Z'] },
  cuisses: { face: ['M98 232C84 230 76 236 74 252C73 276 76 300 82 318L97 318C98 296 99 264 98 232Z'] },
  ischios: { dos: ['M98 244C84 244 76 250 74 264C73 286 77 304 83 320L97 320C98 298 99 270 98 244Z'] },
  mollets: {
    face: ['M82 330C77 350 77 372 82 392L93 392C96 372 96 350 93 330Z'],
    dos: ['M81 328C74 348 76 374 84 396L94 396C99 374 98 348 94 328Z'],
  },
};

const miroir = (chemins) => chemins.map((d) => `<path d="${d}"/><path d="${d}" transform="${SYM}"/>`).join('');

function vue(nom, muscles, interactif) {
  const sil = `${SIL_CENTRE}${SIL_GAUCHE.map((d) => `<path d="${d}"/><path d="${d}" transform="${SYM}"/>`).join('')}`;
  const zones = Object.entries(ZONES).filter(([, z]) => z[nom]).map(([id, z]) => {
    const e = muscles[id];
    return `<g class="mz" data-m="${id}"${e ? ` data-etat="${e}"` : ''}${interactif ? ` role="button" tabindex="0" aria-label="${MUSCLES[id]}${e ? ` : ${ETATS[e]}` : ''}"` : ''}>${miroir(z[nom])}</g>`;
  }).join('');
  return `<figure class="mq-vue"><svg class="mq" viewBox="0 0 200 430" role="img" aria-label="Mannequin, vue ${nom === 'face' ? 'de face' : 'de dos'}">
    <g class="mq-contour">${sil}</g><g class="mq-corps">${sil}</g>${zones}</svg>
    <figcaption>${nom === 'face' ? 'Face' : 'Dos'}</figcaption></figure>`;
}

/**
 * Mannequin de face et de dos.
 * @param {Object<string, 'p'|'s'>} muscles
 * @param {{interactif?: boolean, legende?: boolean, classe?: string}} options
 */
export function htmlMannequin(muscles = {}, { interactif = false, legende = false, classe = '' } = {}) {
  const m = nettoyer(muscles);
  return `<div class="mannequin ${classe}${interactif ? ' interactif' : ''}">
    <div class="mq-vues">${vue('face', m, interactif)}${vue('dos', m, interactif)}</div>
    ${legende ? `<ul class="mq-legende"><li><span class="mq-puce p"></span>Muscle primaire</li><li><span class="mq-puce s"></span>Muscle secondaire</li><li><span class="mq-puce"></span>Non ciblé</li></ul>` : ''}
  </div>`;
}

// ---- Bloc du détail d'une sortie ------------------------------------------------------

/** Faut-il proposer le choix des muscles ? (pas pour les sorties vélo ni course) */
export const avecMuscles = (famille) => !['sport-2', 'sport-1', 'sport-11', 'sport-17', 'sport-5'].includes(famille.cle);

export function htmlBlocMuscles(s, htmlRepli, ouvrir = false) {
  const n = Object.keys(nettoyer(s.muscles)).length;
  return htmlRepli('muscles', 'Muscles travaillés', n ? `${n} zone${n > 1 ? 's' : ''}` : 'À choisir', '<div class="muscles-contenu"></div>', ouvrir);
}

/**
 * Rend et rend interactif le mannequin dans `conteneur` ; enregistre à chaque changement.
 * @param {HTMLElement} conteneur
 * @param {object} s  la sortie
 * @param {(texte: string) => void} toast
 * @param {(muscles: object) => void} apres  appelé après chaque enregistrement
 */
export function installerMuscles(conteneur, s, toast, apres = () => {}) {
  let muscles = nettoyer(s.muscles);
  const rendre = () => {
    const r = resumeMuscles(muscles);
    conteneur.innerHTML = `
      <p class="aide">Touche un muscle : 1 fois = <b class="mq-p">principal</b> (rouge), 2 fois = <b class="mq-s">secondaire</b> (orange), 3 fois = effacé.</p>
      ${htmlMannequin(muscles, { interactif: true, legende: true })}
      <p class="mq-resume">${r ? echapper(r) : 'Aucun muscle choisi.'}</p>
      ${Object.keys(muscles).length ? '<button class="btn secondaire petit" type="button" data-mq="effacer">Tout effacer</button>' : ''}`;
  };
  const garder = async () => {
    s.muscles = muscles;
    try { await completerSortie(s.id, () => ({ muscles })); } catch (e) { console.error(e); toast('Muscles non enregistrés.'); }
    const repli = conteneur.closest('details');
    if (repli) {
      const n = Object.keys(muscles).length;
      repli.querySelector('.repli-resume').textContent = n ? `${n} zone${n > 1 ? 's' : ''}` : 'À choisir';
    }
    apres(muscles);
  };
  const changer = (id) => {
    const e = etatSuivant(muscles[id]);
    if (e) muscles[id] = e; else delete muscles[id];
    rendre();
    garder();
  };
  conteneur.onclick = (ev) => {
    const z = ev.target.closest('.mz');
    if (z) { changer(z.dataset.m); return; }
    if (ev.target.closest('[data-mq="effacer"]')) { muscles = {}; rendre(); garder(); }
  };
  conteneur.onkeydown = (ev) => {
    const z = ev.target.closest?.('.mz');
    if (z && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); changer(z.dataset.m); z.focus?.(); }
  };
  rendre();
}
