# Commercialiser GOATout : ce qui est fait, ce qu'il reste à faire

Choix retenus (11 nov. 2026) : **achat unique**, distribution par le **site web** (l'appli s'installe depuis Chrome).
Ce document ne remplace pas un conseil juridique ou comptable.

## Ce qui est déjà dans l'appli (v0.40.0)

| Élément | Où | État |
|---|---|---|
| Réglages « commerciaux » au même endroit | `js/config.js` | Prêt |
| **Licence d'achat unique**, vérifiée sur le téléphone (aucun serveur) | `js/licence.js`, `js/licence-ui.js` | Prête, **désactivée** : `licenceObligatoire: false` |
| Outil pour créer tes clés et les licences des clients | `outils/licences.html` (s'ouvre seul, sans internet) | Prêt |
| Essai gratuit de 14 jours, écran de licence, export des sorties toujours possible | `js/licence-ui.js` | Prêt |
| Informations légales (mentions, conditions de vente, confidentialité, sources) | `js/legal.js`, page `#legal` | Texte modèle, **à compléter et à faire relire** |
| Fonds de carte au choix : OpenStreetMap ou **Plan IGN** (France), mention obligatoire affichée | `js/fonds-carte.js`, Profil | Prêt |
| Relais météo qui garde ta clé Open-Meteo secrète | `serveur/worker-meteo.js` | Prêt, **à mettre en ligne** |

## À faire par toi, dans cet ordre

### 1. Vérifier le nom « GOATout »
Recherche gratuite sur la base de marques de l'INPI (data.inpi.fr). « GOAT » est très utilisé : regarde les classes 9 (logiciels) et 41–42. Le dépôt de marque coûte environ 190 € pour une classe, il n'est pas obligatoire pour commencer mais protège le nom.

### 2. Statut d'entreprise
Micro-entreprise (gratuit à créer, guichet-entreprises.fr / autoentrepreneur.urssaf.fr). Tu obtiens un SIRET. Remplis ensuite `editeur` dans `js/config.js` (nom, statut, SIRET, adresse, e-mail) : c'est **obligatoire** pour les mentions légales d'une activité commerciale.

### 3. Hébergement qui accepte l'usage commercial
GitHub Pages l'interdit. Cloudflare Pages (gratuit) l'accepte d'après ses conditions publiées : à reconfirmer au moment de te lancer.
1. Compte gratuit sur cloudflare.com → Workers & Pages → Create → Pages → connecter le dépôt GitHub.
2. Aucune commande de build : dossier racine du dépôt, tel quel.
3. Le site sera sur une adresse `xxx.pages.dev` (tu pourras brancher ton propre nom de domaine plus tard).
4. Quand l'adresse change, les clients doivent réinstaller l'appli et **restaurer leur sauvegarde** : prévois-le dès le début, ou prends ton nom de domaine tout de suite.

### 4. Météo : abonnement Open-Meteo commercial
1. Prends l'abonnement (environ 29 $ par mois, à confirmer sur open-meteo.com/en/pricing) **avant la première vente** : l'adresse gratuite est interdite pour l'usage commercial.
2. Crée un Worker Cloudflare avec le code de `serveur/worker-meteo.js`. Variables : `OPEN_METEO_KEY` (ta clé, en « secret ») et `ORIGINES_AUTORISEES` (l'adresse de ton site).
3. Dans `js/config.js`, mets `urlMeteo` à l'adresse de ton Worker suivie de `/v1/forecast`.

### 5. Itinéraires et noms de lieux (les deux autres services gratuits)
- **BRouter** (`urlBrouter`) : le serveur public n'est pas prévu pour une appli vendue. Solutions : écrire à son auteur pour un accord, héberger toi-même BRouter, ou passer à OpenRouteService (usage commercial à confirmer avec eux).
- **Nominatim / Overpass** (`urlNominatim`, `urlOverpass`) : très peu de requêtes (cache + une par seconde). Acceptable à petite échelle ; sinon, retirer les noms proposés (l'appli retombe sur des noms avec les chiffres).

### 5 bis. Fonds de carte
Pour la France, choisis **Plan IGN** dans Profil → Fond de carte et vérifie sur ton téléphone que les cartes s'affichent (je n'ai pas pu tester ce site depuis mon environnement). Pour que ce soit le fond par défaut à la vente, change `FOND_DEFAUT` dans `js/fonds-carte.js`. Hors de France, il faudra un autre fond (OpenFreeMap : chantier plus gros).

### 6. Paiement et licences
1. Compte Stripe (gratuit, commission par vente) → crée un **lien de paiement** (Payment Link) pour GOATout, paiement unique. Mets ce lien dans `urlAchat` (`js/config.js`).
2. Ouvre `outils/licences.html` (double-clic, dans Chrome) → **Créer mes clés**. Enregistre la **clé privée** dans un endroit sûr (gestionnaire de mots de passe). Ne la mets jamais dans GitHub.
3. Colle la **clé publique** dans `cleLicencePublique` (`js/config.js`) (ou envoie-la moi : elle est publique).
4. Pour chaque vente : dans `outils/licences.html`, « Créer la licence d'un client » (nom ou e-mail) → copie le code → envoie-le par e-mail au client. Note-le dans un tableau (numéro `L-…`, nom, date, montant).
5. Quand tout est prêt et que **toi-même tu as activé ta propre licence**, passe `licenceObligatoire` à `true`.
6. Évolution possible plus tard : envoi automatique du code par e-mail après paiement (webhook Stripe + Worker). Je peux le faire ensuite.

### 7. Faire relire les textes
`js/legal.js` est un texte modèle. Fais-le relire (une heure de juriste, ou l'association de consommateurs / la CCI de ta région pour les micro-entrepreneurs) avant d'encaisser, surtout : droit de rétractation, médiation de la consommation, conditions de remboursement.

### 8. Adapter l'appli à d'autres cyclistes (pas encore fait)
Certaines valeurs par défaut sont celles de Cyril : FTP 236 W, poids 98 kg, chaîne BiNavi → Gadgetbridge → zip pour récupérer les sorties. Un client ordinaire ne l'aura pas. À prévoir : écran de bienvenue (FTP, poids), import direct de fichiers FIT / GPX depuis les autres marques (déjà possible via « Importer un fichier »), et un mode d'emploi pour chaque marque.

## À ne jamais faire
- Mettre la clé privée de licence, la clé Open-Meteo, ou tout mot de passe dans le dépôt GitHub (public).
- Passer `licenceObligatoire` à `true` avant d'avoir activé ta licence : tu te bloquerais toi-même (tes sorties resteraient exportables).
- Publier `outils/licences.html` sur le site : c'est un outil privé (il est dans le dépôt mais n'est pas lié à l'appli).
