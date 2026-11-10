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

// Zones : { face: [chemins gauche], dos: [chemins gauche] } ; plusieurs chemins = un seul muscle
const ZONES = {
  trapezes: {
    face: ['M98 56L90 59C86 65 80 68 74 70L84 77C90 77 95 74 98 71Z'],
    dos: ['M99 58L88 61C85 68 79 71 73 72C78 84 88 98 99 124Z'],
  },
  epaules: {
    face: ['M72 70C60 69 50 76 47 90C46 100 49 108 55 112C58 101 63 92 74 86C78 80 77 73 72 70Z'],
    dos: ['M72 70C60 69 50 76 47 90C46 100 49 108 55 112C58 101 63 92 74 86C78 80 77 73 72 70Z'],
  },
  // deux plaques arrondies, séparées au milieu
  pecs: { face: ['M98 81L81 82C74 84 71 90 72 98C73 108 80 115 90 115C94 115 97 113 98 111Z'] },
  biceps: { face: ['M52 116C47 128 46 141 49 153C54 156 60 156 64 153C66 142 66 128 63 114C59 112 55 113 52 116Z'] },
  triceps: { dos: ['M52 116C47 128 46 141 49 153C54 156 60 156 64 153C66 142 66 128 63 114C59 112 55 113 52 116Z'] },
  avantbras: {
    face: ['M49 158C45 176 42 196 41 216L52 220C55 200 58 178 63 158C58 160 53 160 49 158Z'],
    dos: ['M49 158C45 176 42 196 41 216L52 220C55 200 58 178 63 158C58 160 53 160 49 158Z'],
  },
  // huit blocs (4 rangées de 2)
  abdos: { face: [
    'M98 119L89 119C87 119 86 121 86 123L86 134C86 136 87 137 89 137L98 137Z',
    'M98 140L89 140C87 140 86 142 86 144L86 154C86 156 87 157 89 157L98 157Z',
    'M98 160L90 160C88 160 87 162 87 164L87 174C87 176 88 177 90 177L98 177Z',
    'M98 180L91 180C89 180 88 182 88 184L88 192C88 195 91 197 94 198L98 200Z',
  ] },
  obliques: { face: ['M84 117C78 132 76 160 79 188L85 190C83 166 84 140 85 117Z'] },
  dos: { dos: ['M96 132L99 128L99 174C88 166 79 150 76 134C75 120 76 106 80 96C84 110 90 122 96 132Z'] },
  lombaires: { dos: ['M99 177C92 175 87 171 84 166C83 177 85 190 90 200L99 203Z'] },
  fessiers: { dos: ['M99 205C90 203 78 205 74 218C74 232 86 242 99 239Z'] },
  // intérieur (droit fémoral) et extérieur (vaste externe)
  cuisses: { face: [
    'M98 234C94 232 88 232 86 236C85 262 88 296 92 320L98 320C99 296 99 262 98 234Z',
    'M84 237C77 239 74 249 74 263C74 285 77 304 82 320L90 320C86 296 84 262 84 237Z',
  ] },
  ischios: { dos: [
    'M98 245C93 243 88 244 86 248C86 272 89 300 92 321L98 321C99 298 99 270 98 245Z',
    'M84 249C77 251 74 258 74 270C74 288 77 306 82 321L90 321C86 298 84 272 84 249Z',
  ] },
  mollets: {
    face: ['M82 332C77 350 77 372 82 392L93 392C96 372 96 350 93 332Z'],
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
