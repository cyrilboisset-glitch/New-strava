import { familleSortie } from './sortie.js';

// Petites icônes de sport (traits, couleur du texte), dessinées pour l'appli.
const TRAITS = {
  velo: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l2 7h-6M13 6h3"/>',
  course: '<circle cx="14.5" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2v4M6 12l3-3 4 1 2 3 3 1M11 15l2-5"/>',
  marche: '<circle cx="12.5" cy="4.5" r="1.8"/><path d="M10 21l2-6 2 2 1 4M9 13l1-4 3-1 2 3 2 1M12 15l1-7"/>',
  randonnee: '<path d="M3 20l6-9 4 5 3-4 5 8z"/><path d="M14 6l1.5-2L17 6"/>',
  natation: '<circle cx="16" cy="7" r="1.8"/><path d="M3 17c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M6 13l5-4 3 3"/>',
  velovirtuel: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M6.5 12.5l3-3.5 3 2 4-4.5"/>',
  musculation: '<path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10"/>',
  neige: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5L12 6l2.5-1.5M9.5 19.5L12 18l2.5 1.5"/>',
  eau: '<path d="M12 3v8l5-1.5zM6 12h12l-2 4H8z"/><path d="M3 20c2 1.2 4 1.2 6 0s4-1.2 6 0 4 1.2 6 0"/>',
  balle: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16M6.3 6.3c3 3 3 8.4 0 11.4M17.7 6.3c-3 3-3 8.4 0 11.4"/>',
  escalade: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="9" cy="8" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="10" cy="16" r="1.2"/>',
  glisse: '<path d="M4 8h9l3 5h4v3H4z"/><circle cx="7" cy="19" r="1"/><circle cx="17" cy="19" r="1"/>',
  entrainement: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  autre: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  tout: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
};

// Famille d'activité (clé de familleSortie, ou « tout ») -> icône
const PAR_FAMILLE = { 'sport-2': 'velo', 'velo-virtuel': 'velovirtuel', 'sport-1': 'course', 'sport-11': 'marche', 'sport-17': 'randonnee', 'sport-5': 'natation', 'sport-10': 'entrainement', musculation: 'musculation', neige: 'neige', eau: 'eau', balle: 'balle', escalade: 'escalade', glisse: 'glisse', tout: 'tout' };
export function iconeFamille(cle, taille = 22) {
  return `<svg class="icone-sport" viewBox="0 0 24 24" width="${taille}" height="${taille}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TRAITS[PAR_FAMILLE[cle] ?? 'autre']}</svg>`;
}

export function iconeSport(s, taille = 22) {
  const cle = PAR_FAMILLE[familleSortie(s).cle] ?? 'autre';
  return `<svg class="icone-sport" viewBox="0 0 24 24" width="${taille}" height="${taille}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TRAITS[cle]}</svg>`;
}
