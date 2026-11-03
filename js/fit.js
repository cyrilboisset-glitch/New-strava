// Lecteur de fichiers FIT (format Garmin, utilisé aussi par iGPSport).
// Décode seulement les messages utiles à l'appli. Fonctionne dans le
// navigateur et dans Node (tests).
//
// Référence : FIT SDK, profil « Profile.xlsx » (numéros de messages et de
// champs, échelles et décalages).

const EPOQUE_FIT_S = 631065600; // 1989-12-31 00:00:00 UTC, en secondes Unix

// Types de base : [taille en octets, valeur invalide, lecteur]
const TYPES = {
  0x00: { taille: 1, invalide: 0xff, lire: (v, o) => v.getUint8(o) }, // enum
  0x01: { taille: 1, invalide: 0x7f, lire: (v, o) => v.getInt8(o) }, // sint8
  0x02: { taille: 1, invalide: 0xff, lire: (v, o) => v.getUint8(o) }, // uint8
  0x03: { taille: 2, invalide: 0x7fff, lire: (v, o, le) => v.getInt16(o, le) }, // sint16
  0x04: { taille: 2, invalide: 0xffff, lire: (v, o, le) => v.getUint16(o, le) }, // uint16
  0x05: { taille: 4, invalide: 0x7fffffff, lire: (v, o, le) => v.getInt32(o, le) }, // sint32
  0x06: { taille: 4, invalide: 0xffffffff, lire: (v, o, le) => v.getUint32(o, le) }, // uint32
  0x07: { taille: 1, invalide: null, lire: null }, // chaîne
  0x08: { taille: 4, invalide: NaN, lire: (v, o, le) => v.getFloat32(o, le) }, // float32
  0x09: { taille: 8, invalide: NaN, lire: (v, o, le) => v.getFloat64(o, le) }, // float64
  0x0a: { taille: 1, invalide: 0x00, lire: (v, o) => v.getUint8(o) }, // uint8z
  0x0b: { taille: 2, invalide: 0x0000, lire: (v, o, le) => v.getUint16(o, le) }, // uint16z
  0x0c: { taille: 4, invalide: 0x00000000, lire: (v, o, le) => v.getUint32(o, le) }, // uint32z
  0x0d: { taille: 1, invalide: 0xff, lire: (v, o) => v.getUint8(o) }, // octet
  0x0e: { taille: 8, invalide: null, lire: (v, o, le) => v.getBigInt64(o, le) }, // sint64
  0x0f: { taille: 8, invalide: null, lire: (v, o, le) => v.getBigUint64(o, le) }, // uint64
  0x10: { taille: 8, invalide: null, lire: (v, o, le) => v.getBigUint64(o, le) }, // uint64z
};

// Champs décodés : numéro de champ -> [nom, échelle, décalage]
// (valeur réelle = brute / échelle - décalage)
const DATE = 'date'; // marqueur : champ date FIT -> objet Date
const PROFIL = {
  0: { nom: 'file_id', champs: {
    0: ['type'], 1: ['fabricant'], 2: ['produit'], 3: ['numeroSerie'], 4: ['creation', DATE],
  } },
  7: { nom: 'zones_target', champs: {
    1: ['fcMax'], 2: ['fcSeuil'], 3: ['ftpW'],
  } },
  12: { nom: 'sport', champs: { 0: ['sport'], 1: ['sousSport'], 3: ['nom'] } },
  18: { nom: 'session', champs: {
    253: ['horodatage', DATE], 2: ['debut', DATE],
    3: ['latDepart', 'semi'], 4: ['lonDepart', 'semi'],
    5: ['sport'], 6: ['sousSport'],
    7: ['dureeTotaleS', 1000], 8: ['dureeChronoS', 1000], 9: ['distanceM', 100],
    11: ['calories'], 14: ['vitesseMoyMs', 1000], 15: ['vitesseMaxMs', 1000],
    16: ['fcMoy'], 17: ['fcMax'], 18: ['cadenceMoy'], 19: ['cadenceMax'],
    20: ['puissanceMoyW'], 21: ['puissanceMaxW'], 22: ['denivelePosM'], 23: ['deniveleNegM'],
    34: ['puissanceNormW'], 35: ['tss', 10], 36: ['facteurIntensite', 1000],
    37: ['equilibreGD'], 57: ['temperatureMoy'], 58: ['temperatureMax'],
    59: ['dureeMouvementS', 1000],
    124: ['vitesseMoyMs', 1000], 125: ['vitesseMaxMs', 1000],
  } },
  19: { nom: 'lap', champs: {
    253: ['horodatage', DATE], 2: ['debut', DATE],
    7: ['dureeTotaleS', 1000], 8: ['dureeChronoS', 1000], 9: ['distanceM', 100],
    13: ['vitesseMoyMs', 1000], 15: ['fcMoy'], 17: ['cadenceMoy'], 19: ['puissanceMoyW'],
    21: ['denivelePosM'], 33: ['puissanceNormW'], 110: ['vitesseMoyMs', 1000],
  } },
  20: { nom: 'record', champs: {
    253: ['horodatage', DATE], 0: ['lat', 'semi'], 1: ['lon', 'semi'],
    2: ['altitudeM', 5, 500], 3: ['fc'], 4: ['cadence'], 5: ['distanceM', 100],
    6: ['vitesseMs', 1000], 7: ['puissanceW'], 9: ['pentePct', 100], 13: ['temperature'],
    30: ['equilibreGD'], 43: ['efficaciteCoupleGauche', 2], 44: ['efficaciteCoupleDroite', 2],
    45: ['fluiditeGauche', 2], 46: ['fluiditeDroite', 2],
    73: ['vitesseMs', 1000], 78: ['altitudeM', 5, 500],
  } },
  21: { nom: 'event', champs: { 253: ['horodatage', DATE], 0: ['evenement'], 1: ['typeEvenement'] } },
  23: { nom: 'device_info', champs: {
    2: ['fabricant'], 4: ['produit'], 5: ['versionLogiciel', 100],
  } },
};

const SEMI_VERS_DEG = 180 / 2 ** 31;

function convertir(brut, def) {
  const [, echelle, decalage] = def;
  if (echelle === DATE) return new Date((brut + EPOQUE_FIT_S) * 1000);
  if (echelle === 'semi') return brut * SEMI_VERS_DEG;
  let v = brut;
  if (typeof echelle === 'number') v = v / echelle;
  if (typeof decalage === 'number') v = v - decalage;
  return v;
}

/**
 * Décode un fichier FIT.
 * @param {ArrayBuffer} tampon
 * @param {{seulementEntete?: boolean}} options  seulementEntete : s'arrête
 *   après le message file_id (pour trier vite les fichiers d'un zip).
 * @returns {{fileId, session, laps, records, events, sport, zones, appareil}}
 */
export function lireFit(tampon, options = {}) {
  const vue = new DataView(tampon);
  if (tampon.byteLength < 12) throw new Error('Fichier FIT trop court');
  const tailleEntete = vue.getUint8(0);
  const tailleDonnees = vue.getUint32(4, true);
  const signature = String.fromCharCode(vue.getUint8(8), vue.getUint8(9), vue.getUint8(10), vue.getUint8(11));
  if (signature !== '.FIT') throw new Error('Pas un fichier FIT');

  const fin = Math.min(tailleEntete + tailleDonnees, tampon.byteLength);
  const definitions = new Map(); // type local -> définition
  const res = { fileId: null, session: null, laps: [], records: [], events: [], sport: null, zones: null, appareil: null };
  let dernierHorodatage = 0; // brut, pour les en-têtes compressés
  let pos = tailleEntete;

  while (pos < fin) {
    const entete = vue.getUint8(pos++);
    let typeLocal;
    let horodatageCompresse = null;

    if (entete & 0x80) {
      // En-tête compressé : horodatage relatif sur 5 bits
      typeLocal = (entete >> 5) & 0x03;
      const decal = entete & 0x1f;
      let t = (dernierHorodatage & ~0x1f) + decal;
      if (decal < (dernierHorodatage & 0x1f)) t += 0x20;
      dernierHorodatage = t;
      horodatageCompresse = t;
    } else if (entete & 0x40) {
      // Message de définition
      typeLocal = entete & 0x0f;
      const avecDev = (entete & 0x20) !== 0;
      const petitBoutiste = vue.getUint8(pos + 1) === 0;
      const numGlobal = vue.getUint16(pos + 2, petitBoutiste);
      const nbChamps = vue.getUint8(pos + 4);
      pos += 5;
      const champs = [];
      for (let i = 0; i < nbChamps; i++) {
        champs.push({ num: vue.getUint8(pos), taille: vue.getUint8(pos + 1), type: vue.getUint8(pos + 2) & 0x1f });
        pos += 3;
      }
      let tailleDev = 0;
      if (avecDev) {
        const nbDev = vue.getUint8(pos++);
        for (let i = 0; i < nbDev; i++) { tailleDev += vue.getUint8(pos + 1); pos += 3; }
      }
      definitions.set(typeLocal, { numGlobal, petitBoutiste, champs, tailleDev });
      continue;
    } else {
      typeLocal = entete & 0x0f;
    }

    // Message de données
    const def = definitions.get(typeLocal);
    if (!def) throw new Error(`Données sans définition (type local ${typeLocal}) à l'octet ${pos - 1}`);
    const profil = PROFIL[def.numGlobal];
    const msg = profil ? {} : null;

    for (const c of def.champs) {
      const t = TYPES[c.type];
      if (profil && t && profil.champs[c.num]) {
        const defChamp = profil.champs[c.num];
        let valeur = null;
        if (c.type === 0x07) {
          const octets = new Uint8Array(tampon, pos, c.taille);
          const zero = octets.indexOf(0);
          valeur = new TextDecoder().decode(zero >= 0 ? octets.subarray(0, zero) : octets) || null;
        } else if (t.lire && c.taille >= t.taille) {
          // Tableau : on garde seulement le premier élément
          const brut = t.lire(vue, pos, def.petitBoutiste);
          if (typeof brut === 'bigint' || brut !== t.invalide && !Number.isNaN(brut)) {
            valeur = typeof brut === 'bigint' ? Number(brut) : convertir(brut, defChamp);
          }
        }
        if (valeur !== null) msg[defChamp[0]] = valeur;
      }
      if (c.num === 253 && c.type === 0x06 && c.taille === 4) {
        const brut = vue.getUint32(pos, def.petitBoutiste);
        if (brut !== 0xffffffff) dernierHorodatage = brut;
      }
      pos += c.taille;
    }
    pos += def.tailleDev;

    if (!profil) continue;
    if (horodatageCompresse !== null && msg.horodatage === undefined) {
      msg.horodatage = new Date((horodatageCompresse + EPOQUE_FIT_S) * 1000);
    }

    switch (profil.nom) {
      case 'file_id':
        if (!res.fileId) res.fileId = msg;
        if (options.seulementEntete) return res;
        break;
      case 'session': if (!res.session) res.session = msg; break;
      case 'lap': res.laps.push(msg); break;
      case 'record': res.records.push(msg); break;
      case 'event': res.events.push(msg); break;
      case 'sport': if (!res.sport) res.sport = msg; break;
      case 'zones_target': if (!res.zones || msg.ftpW) res.zones = msg; break;
      case 'device_info': if (!res.appareil) res.appareil = msg; break;
    }
  }
  return res;
}

// Équilibre gauche/droite sur 8 bits (record) : bit 7 = côté droit,
// 7 bits bas = pourcentage de ce côté. Renvoie le % côté gauche.
export function equilibreGauchePct8(v) {
  if (v === undefined || v === null || v === 0xff) return null;
  const pct = v & 0x7f;
  return v & 0x80 ? 100 - pct : pct;
}

// Équilibre sur 16 bits (session) : bit 15 = côté droit, 14 bits bas = % × 100.
export function equilibreGauchePct16(v) {
  if (v === undefined || v === null || v === 0xffff) return null;
  const pct = (v & 0x3fff) / 100;
  return v & 0x8000 ? 100 - pct : pct;
}

export const TYPE_FICHIER_ACTIVITE = 4;
