// Pression des pneus conseillée (sans navigateur, testé dans Node).
//
// C'est une ESTIMATION de départ, pas une valeur garantie : formule simple, calée sur des valeurs
// courantes de pneus vélo (environ 4 bar à l'arrière pour 80 kg au total en 28 mm sur route lisse),
// puis corrigée par ce que l'appli sait du trajet et de la météo. À ajuster selon ton ressenti ;
// ne dépasse jamais la pression maximale marquée sur le pneu et sur la jante.
//
//  - Charge sur chaque roue = poids total × part avant / arrière. À plat, ~45 % devant, 55 % derrière ;
//    dans les descentes raides le poids passe vers l'avant (jusqu'à 50 %).
//  - Pression ∝ charge / largeur² : un pneu plus large porte la même charge à pression plus basse.
//  - Tubeless : ~8 % plus bas qu'avec chambre à air. Revêtement : plus c'est rugueux, plus on baisse.
//  - Pluie : on baisse un peu pour l'adhérence.
//  - Température : l'air se contracte au froid. Gonflé chez toi à 20 °C puis roulé à 5 °C, le pneu perd
//    de la pression ; on donne donc aussi la valeur à gonfler à 20 °C pour avoir la bonne pression dehors.

export const EQUIPEMENT_KG = 2; // casque, chaussures, tenue, bidons : ajoutés au poids du pilote et du vélo
export const COEFF_PRESSION = 71.3; // bar · mm² / kg (charge sur la roue × 71,3 / largeur²)
export const PART_AVANT = 0.45;
export const PART_AVANT_DESCENTE = 0.5; // atteinte si 20 % du trajet ou plus est en descente raide
export const SEUIL_DESCENTE_RAIDE = 0.06; // pente de −6 % et plus raide
export const GONFLAGE_C = 20; // température où l'on gonfle d'ordinaire (maison, garage)
export const BAR_EN_PSI = 14.5038;

export const REVETEMENTS = {
  route: { nom: 'Route lisse', facteur: 1 },
  abimee: { nom: 'Route abîmée, pavés', facteur: 0.92 },
  mixte: { nom: 'Route et chemins', facteur: 0.88 },
  chemin: { nom: 'Chemin, gravel', facteur: 0.78 },
};
export const FACTEUR_TUBELESS = 0.92;
const PRESSION_MIN_BAR = 0.8;
const PRESSION_MAX_BAR = 9;

export const enPsi = (bar) => bar * BAR_EN_PSI;
const arrondiBar = (v) => Math.round(v / 0.05) * 0.05; // au 0,05 bar près : ce qu'une pompe sait lire

/** Pente lissée sur ±50 m, comme pour le temps estimé du tracé (coords : [lat, lon, altitude]) */
export function statsDescente(coords, distance) {
  if (!coords?.length || !coords.every((c) => typeof c[2] === 'number')) return null;
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distance(coords[i - 1], coords[i]));
  let raide = 0; let total = 0; let penteMax = 0; let a = 0; let b = 0;
  for (let i = 1; i < coords.length; i++) {
    const ds = cum[i] - cum[i - 1];
    if (ds <= 0) continue;
    const milieu = (cum[i] + cum[i - 1]) / 2;
    while (cum[a] < milieu - 50) a++;
    while (b < coords.length - 1 && cum[b + 1] <= milieu + 50) b++;
    const dd = cum[b] - cum[a];
    const pente = dd > 20 ? Math.max(-0.25, Math.min(0.25, (coords[b][2] - coords[a][2]) / dd)) : 0;
    total += ds;
    if (pente <= -SEUIL_DESCENTE_RAIDE) raide += ds;
    penteMax = Math.min(penteMax, pente);
  }
  return { partDescenteRaide: total ? raide / total : 0, penteDescenteMaxPct: Math.round(-penteMax * 1000) / 10, distanceM: total };
}

/**
 * @param {{poidsPiloteKg: number, poidsVeloKg: number, largeurMm: number, tubeless?: boolean,
 *   revetement?: keyof typeof REVETEMENTS, tempC?: number|null, pluiePct?: number, pluieMm?: number,
 *   partDescenteRaide?: number, tempGonflageC?: number}} p
 * @returns {{chargeKg, partAvant, avantBar, arriereBar, gonfleAvantBar, gonfleArriereBar, facteurs: {texte: string, pct: number}[]} | null}
 */
export function pressionPneus(p) {
  const { poidsPiloteKg, poidsVeloKg, largeurMm } = p;
  if (!(poidsPiloteKg > 0) || !(poidsVeloKg > 0) || !(largeurMm >= 18 && largeurMm <= 80)) return null;
  const chargeKg = poidsPiloteKg + poidsVeloKg + EQUIPEMENT_KG;
  const descente = Math.max(0, Math.min(1, (p.partDescenteRaide ?? 0) / 0.2));
  const partAvant = PART_AVANT + (PART_AVANT_DESCENTE - PART_AVANT) * descente;
  const facteurs = [];
  let k = 1;
  const ajouter = (texte, facteur) => {
    if (facteur === 1) return;
    k *= facteur;
    facteurs.push({ texte, pct: Math.round((facteur - 1) * 100) });
  };
  if (p.tubeless) ajouter('Tubeless', FACTEUR_TUBELESS);
  const rev = REVETEMENTS[p.revetement] ?? REVETEMENTS.route;
  ajouter(rev.nom, rev.facteur);
  const mm = p.pluieMm ?? 0;
  const pct = p.pluiePct ?? 0;
  if (mm >= 2) ajouter('Forte pluie prévue', 0.92);
  else if (mm >= 0.3) ajouter('Pluie prévue', 0.95);
  else if (pct >= 50) ajouter('Pluie probable', 0.97);
  const base = (charge) => Math.max(PRESSION_MIN_BAR, Math.min(PRESSION_MAX_BAR, (COEFF_PRESSION * charge * k) / (largeurMm * largeurMm)));
  const avant = base(chargeKg * partAvant);
  const arriere = base(chargeKg * (1 - partAvant));
  const res = { chargeKg, partAvant, avantBar: arrondiBar(avant), arriereBar: arrondiBar(arriere), gonfleAvantBar: null, gonfleArriereBar: null, facteurs };
  if (typeof p.tempC === 'number') {
    // même quantité d'air : P(absolue) proportionnelle à la température absolue
    const dehors = p.tempC + 273.15;
    const maison = (p.tempGonflageC ?? GONFLAGE_C) + 273.15;
    const gonfle = (bar) => arrondiBar((bar + 1.01325) * (maison / dehors) - 1.01325);
    res.gonfleAvantBar = gonfle(avant);
    res.gonfleArriereBar = gonfle(arriere);
  }
  return res;
}
