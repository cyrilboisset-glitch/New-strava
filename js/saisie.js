// Activité saisie à la main, sans fichier (sans navigateur, testé dans Node).
// Le résumé a la même forme que celui d'une sortie importée sans trace (voir resumerSansTrace) :
// la liste, le détail, Progrès et la sauvegarde la traitent comme les autres sorties.

const JOUR_MS = 86400000;

export const idSaisie = (maintenantMs = Date.now()) => `manuel-${maintenantMs.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Vérifie les champs saisis (texte ou nombres) ; renvoie { erreurs: string[], valeurs }.
 * @param {{debutMs: number, dureeS: number, distanceKm?: number|null, denivelePosM?: number|null,
 *   fcMoy?: number|null, puissanceMoyW?: number|null, calories?: number|null}} f
 */
export function validerSaisie(f, maintenantMs = Date.now()) {
  const erreurs = [];
  if (!Number.isFinite(f.debutMs)) erreurs.push('La date et l\'heure ne sont pas valides.');
  else if (f.debutMs > maintenantMs + JOUR_MS) erreurs.push('La date est dans le futur.');
  if (!(f.dureeS >= 60)) erreurs.push('La durée doit être d\'au moins 1 minute.');
  else if (f.dureeS > 14 * 86400) erreurs.push('La durée est trop longue (14 jours au plus).');
  const borne = (v, nom, min, max, unite) => {
    if (v == null) return;
    if (!(v >= min && v <= max)) erreurs.push(`${nom} : entre ${min} et ${max} ${unite}.`);
  };
  borne(f.distanceKm, 'Distance', 0, 3000, 'km');
  borne(f.denivelePosM, 'Dénivelé', 0, 30000, 'm');
  borne(f.fcMoy, 'Fréquence cardiaque', 30, 250, 'bpm');
  borne(f.puissanceMoyW, 'Puissance', 0, 2500, 'W');
  borne(f.calories, 'Calories', 0, 30000, 'kcal');
  return erreurs;
}

/**
 * Résumé d'une sortie saisie à la main.
 * @param {{id: string, nom?: string, type: {sport: number, sousSport: number, nomSport: string}, debutMs: number,
 *   dureeS: number, distanceKm?: number|null, denivelePosM?: number|null, fcMoy?: number|null,
 *   puissanceMoyW?: number|null, calories?: number|null, veloId?: string|null}} f
 */
export function resumerSaisie(f) {
  const distanceM = f.distanceKm ? Math.round(f.distanceKm * 1000) : null;
  const p = f.puissanceMoyW || null;
  return {
    id: f.id,
    nomFichier: null,
    nom: (f.nom ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || undefined,
    source: 'manuel',
    sansTrace: true,
    debut: f.debutMs,
    sport: f.type.sport, sousSport: f.type.sousSport, nomSport: f.type.nomSport,
    dureeChronoS: Math.round(f.dureeS),
    dureeTotaleS: Math.round(f.dureeS),
    distanceM,
    denivelePosM: f.denivelePosM != null ? Math.round(f.denivelePosM) : null,
    vitesseMoyMs: distanceM ? distanceM / f.dureeS : null,
    // sans points, la puissance normalisée est prise égale à la moyenne (pour la charge d'entraînement)
    puissanceMoyW: p, puissanceNormW: p, puissanceMaxW: null, tss: null, facteurIntensite: null,
    fcMoy: f.fcMoy || null, fcMax: null, cadenceMoy: null, calories: f.calories || null, temperatureMoy: null, ftpCompteurW: null,
    nbPoints: 0, nbTours: 0, trace: [],
    ...(f.veloId ? { veloId: f.veloId } : {}),
  };
}
