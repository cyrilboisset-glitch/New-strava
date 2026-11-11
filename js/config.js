// Réglages « commerciaux » de GOATout, au même endroit : services extérieurs, licence, identité
// de l'éditeur. Changer une valeur ici suffit (voir COMMERCIALISATION.md).
// Rien de personnel dans ce fichier : il est public (dépôt GitHub).

export const CONFIG = {
  // ---- Services extérieurs (adresse de base). Pour vendre : voir COMMERCIALISATION.md ----
  // Open-Meteo : l'adresse gratuite est réservée à l'usage non commercial. Après l'abonnement,
  // mettre l'adresse du relais (serveur/worker-meteo.js) qui ajoute la clé, jamais la clé ici.
  urlMeteo: 'https://api.open-meteo.com/v1/forecast',
  urlBrouter: 'https://brouter.de/brouter',
  urlNominatim: 'https://nominatim.openstreetmap.org/reverse',
  urlOverpass: 'https://overpass-api.de/api/interpreter',

  // ---- Licence (achat unique) ----
  // licenceObligatoire false : tout est libre (comme aujourd'hui). À mettre à true seulement quand
  // la clé publique ci-dessous est remplie et que les premières licences sont délivrées.
  licenceObligatoire: false,
  // Clé publique de vérification des licences (JWK ECDSA P-256), créée avec outils/licences.html.
  // C'est une clé PUBLIQUE : elle peut rester dans le dépôt. La clé privée ne doit jamais y être.
  cleLicencePublique: null,
  essaiJours: 14,
  urlAchat: '', // page de paiement (lien Stripe Payment Link, par exemple)

  // ---- Éditeur : à compléter avant la mise en vente (mentions légales) ----
  editeur: {
    nom: '', // nom et prénom, ou raison sociale
    statut: '', // ex. « Entrepreneur individuel (micro-entreprise) »
    siret: '',
    adresse: '', // adresse postale (obligatoire pour une activité commerciale)
    email: '', // contact et support
    hebergeur: 'Cloudflare, Inc. (hébergement du site) : à confirmer selon l\'hébergeur choisi',
  },
};
