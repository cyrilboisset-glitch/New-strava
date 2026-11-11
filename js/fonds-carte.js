// Fond de carte : un seul endroit pour l'adresse des tuiles et la mention obligatoire.
// OpenStreetMap (tuiles du projet : usage léger) ou Plan IGN (France, Géoplateforme de l'IGN,
// Licence Ouverte 2.0 : à confirmer sur geoservices.ign.fr avant la vente). Le choix est dans
// Profil ; il s'applique aux cartes Leaflet, aux petites cartes de la liste et à l'image à partager.
// Sans navigateur : testé dans Node (tests/test-fonds-carte.mjs).

export const FONDS = {
  osm: {
    nom: 'OpenStreetMap',
    note: 'Monde entier. Fond du projet OpenStreetMap, réservé à un usage léger.',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    credit: '© OpenStreetMap',
  },
  ign: {
    nom: 'Plan IGN (France)',
    note: 'France seulement. Cartes de l\'IGN, gratuites pour la réutilisation, même commerciale (Licence Ouverte), avec mention.',
    url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png',
    maxZoom: 18,
    attribution: '© <a href="https://geoservices.ign.fr/">IGN</a> – Géoplateforme · données © contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    credit: '© IGN',
  },
};
export const FOND_DEFAUT = 'osm';

let cle = FOND_DEFAUT;

/** Fond choisi (clé inconnue = fond par défaut) */
export function choisirFond(nouvelle) {
  cle = FONDS[nouvelle] ? nouvelle : FOND_DEFAUT;
  return cle;
}
export const fondActuel = () => FONDS[cle];
export const cleFondActuel = () => cle;

/** Adresse d'une tuile (z, x, y) */
export const urlTuile = (t, fond = fondActuel()) => fond.url.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);

/** Ajoute le fond choisi à une carte Leaflet */
export function ajouterFond(L, carte) {
  const f = fondActuel();
  return L.tileLayer(f.url, { maxZoom: f.maxZoom, attribution: f.attribution }).addTo(carte);
}
