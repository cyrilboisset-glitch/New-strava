// Petites icônes de sport (traits, couleur du texte), dessinées pour l'appli.
const TRAITS = {
  velo: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l2 7h-6M13 6h3"/>',
  course: '<circle cx="14.5" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2v4M6 12l3-3 4 1 2 3 3 1M11 15l2-5"/>',
  marche: '<circle cx="12.5" cy="4.5" r="1.8"/><path d="M10 21l2-6 2 2 1 4M9 13l1-4 3-1 2 3 2 1M12 15l1-7"/>',
  randonnee: '<path d="M3 20l6-9 4 5 3-4 5 8z"/><path d="M14 6l1.5-2L17 6"/>',
  natation: '<circle cx="16" cy="7" r="1.8"/><path d="M3 17c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M6 13l5-4 3 3"/>',
  musculation: '<path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10"/>',
  entrainement: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  autre: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  tout: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
};

// Famille d'activité (clé de familleSortie, ou « tout ») -> icône
const PAR_FAMILLE = { 'sport-2': 'velo', 'sport-1': 'course', 'sport-11': 'marche', 'sport-17': 'randonnee', 'sport-5': 'natation', 'sport-10': 'entrainement', musculation: 'musculation', tout: 'tout' };
export function iconeFamille(cle, taille = 22) {
  return `<svg class="icone-sport" viewBox="0 0 24 24" width="${taille}" height="${taille}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TRAITS[PAR_FAMILLE[cle] ?? 'autre']}</svg>`;
}

const PAR_SPORT = { 2: 'velo', 21: 'velo', 1: 'course', 11: 'marche', 17: 'randonnee', 5: 'natation', 10: 'entrainement' };

export function iconeSport(s, taille = 22) {
  const cle = s.sport === 10 && s.sousSport === 20 ? 'musculation' : PAR_SPORT[s.sport] ?? 'autre';
  return `<svg class="icone-sport" viewBox="0 0 24 24" width="${taille}" height="${taille}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TRAITS[cle]}</svg>`;
}
