// Informations légales : mentions légales, conditions d'utilisation et de vente, confidentialité,
// sources de données et licences. Texte MODÈLE écrit sans juriste : à faire relire avant la mise
// en vente (voir COMMERCIALISATION.md). L'identité de l'éditeur vient de js/config.js.
import { CONFIG } from './config.js';
import { echapper, htmlRepli, suivreReplis } from './format.js';

const aCompleter = (v) => (v ? echapper(v) : '<mark class="a-completer">[à compléter avant la mise en vente]</mark>');
const e = CONFIG.editeur;

const SECTIONS = [
  ['mentions', 'Mentions légales', `
    <p><b>Éditeur</b> : ${aCompleter(e.nom)}<br>Statut : ${aCompleter(e.statut)}<br>SIRET : ${aCompleter(e.siret)}<br>Adresse : ${aCompleter(e.adresse)}<br>Contact : ${aCompleter(e.email)}</p>
    <p><b>Hébergement du site</b> : ${echapper(e.hebergeur)}.</p>
    <p><b>Marque</b> : « GOATout » est le nom de l'application. Les autres noms cités (Strava, Gadgetbridge, iGPSport, Garmin, Zepp, OpenStreetMap…) appartiennent à leurs propriétaires ; GOATout n'est ni affilié à eux ni approuvé par eux.</p>`],
  ['cgu', 'Conditions d\'utilisation et de vente', `
    <p><b>1. Objet.</b> GOATout est une application web installable qui lit, affiche et analyse les sorties sportives de l'utilisateur, et l'aide à préparer des parcours. Elle fonctionne sur son appareil.</p>
    <p><b>2. Essai et licence.</b> L'application est utilisable gratuitement pendant ${CONFIG.essaiJours} jours. La suite nécessite une licence, vendue en <b>paiement unique</b> au prix affiché sur la page d'achat, pour l'appareil et le navigateur de l'acheteur, à usage personnel. Le code de licence est personnel : il ne doit pas être partagé ni revendu.</p>
    <p><b>3. Paiement.</b> Le paiement est traité par un prestataire de paiement tiers ; l'éditeur ne reçoit ni ne garde les numéros de carte. La licence est envoyée à l'adresse e-mail indiquée lors de l'achat.</p>
    <p><b>4. Droit de rétractation.</b> S'agissant d'un contenu numérique fourni immédiatement, le consommateur reconnaît, en demandant l'accès immédiat à la licence, perdre son droit de rétractation une fois la licence délivrée. En cas de défaut de fonctionnement non corrigé, l'éditeur propose le remboursement dans les 30 jours suivant l'achat, sur demande à l'adresse de contact.</p>
    <p><b>5. Données de l'utilisateur.</b> Les sorties et réglages restent sur l'appareil de l'utilisateur, qui peut toujours les exporter (Profil → Exporter). L'éditeur n'y a pas accès et ne les sauvegarde pas : <b>l'utilisateur doit faire ses propres sauvegardes</b>. Effacer les données du navigateur ou désinstaller le navigateur peut les supprimer.</p>
    <p><b>6. Services extérieurs.</b> Certaines fonctions s'appuient sur des services tiers (cartes, météo, calcul d'itinéraire, noms de lieux) qui peuvent changer, être indisponibles ou limités. Elles sont fournies sans garantie de disponibilité.</p>
    <p><b>7. Sécurité et santé.</b> Les estimations (puissance, FTP, temps de parcours, prévisions de vent et de météo, risque de pluie) sont indicatives. Elles ne remplacent ni un avis médical ni la prudence : l'utilisateur reste seul responsable de ses sorties et du respect du code de la route.</p>
    <p><b>8. Responsabilité.</b> L'application est fournie « en l'état ». Dans les limites permises par la loi, l'éditeur n'est pas responsable des dommages indirects, des données perdues ou des décisions prises à partir des résultats affichés. Les droits légaux des consommateurs ne sont pas limités.</p>
    <p><b>9. Droit applicable.</b> Droit français. En cas de litige, le consommateur peut recourir gratuitement à un médiateur de la consommation dont les coordonnées sont communiquées sur demande.</p>`],
  ['confidentialite', 'Confidentialité', `
    <p><b>Ce que l'éditeur collecte : rien.</b> Il n'y a ni compte, ni publicité, ni outil de statistiques. Tes sorties, tes fréquences cardiaques, ton poids, ta FTP et tes réglages restent dans le stockage de ton navigateur, sur ton appareil. La vérification de la licence se fait sur l'appareil, sans envoyer d'information.</p>
    <p><b>Ce qui part vers des services tiers, quand tu utilises la fonction :</b></p>
    <ul>
      <li><b>Cartes</b> (OpenStreetMap ou IGN, au choix dans Profil) : ton adresse IP et la zone de carte affichée.</li>
      <li><b>Météo et vent</b> (Open-Meteo) : une trentaine de points du tracé que tu prépares, jamais une sortie enregistrée.</li>
      <li><b>Calcul d'itinéraire</b> (BRouter) : les points que tu places sur la carte.</li>
      <li><b>Noms de lieux</b> (Nominatim, Overpass d'OpenStreetMap) : quelques points (départ, sommet, arrivée).</li>
    </ul>
    <p>Chacun de ces services applique sa propre politique. Aucune donnée de santé ni aucune sortie complète n'est envoyée.</p>
    <p><b>Tes droits.</b> Comme l'éditeur ne détient pas tes données, il n'a rien à t'envoyer ni à effacer : tu les exportes ou les supprimes toi-même depuis ton appareil. Pour toute question : ${aCompleter(e.email)}.</p>`],
  ['sources', 'Données et logiciels utilisés', `
    <ul>
      <li><b>Cartes</b> : © contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> (licence ODbL) ; Plan IGN : © <a href="https://geoservices.ign.fr/">IGN</a> (Licence Ouverte 2.0).</li>
      <li><b>Météo</b> : <a href="https://open-meteo.com/">Open-Meteo.com</a> (CC BY 4.0).</li>
      <li><b>Itinéraires</b> : <a href="https://brouter.de/">BRouter</a>, sur données OpenStreetMap.</li>
      <li><b>Cartographie dans l'appli</b> : <a href="https://leafletjs.com/">Leaflet</a> (licence BSD-2).</li>
      <li><b>Archives zip</b> : <a href="https://stuk.github.io/jszip/">JSZip</a> (licence MIT).</li>
      <li><b>Polices</b> : Barlow Condensed et Space Grotesk (SIL Open Font License 1.1).</li>
    </ul>`],
];

export function afficherLegal(page) {
  page.innerHTML = `<section class="carte bloc" id="bloc-legal">
    ${e.nom ? '' : '<p class="aide">Modèle de texte à compléter et à faire relire avant la vente (COMMERCIALISATION.md).</p>'}
    ${SECTIONS.map(([cle, titre, texte]) => htmlRepli(`legal-${cle}`, titre, '', `<div class="legal-texte">${texte}</div>`)).join('')}
  </section>`;
  suivreReplis(page.querySelector('#bloc-legal'));
}
