// Données fabriquées pour les tests de l'import Strava : GPX, TCX, FIT et
// activities.csv, aux valeurs connues (pas de vraie sortie nécessaire).

const R = 6371000; // même rayon que js/trace.js
const DEG_PAR_M = 180 / (Math.PI * R);

export const DEBUT_GPX = Date.UTC(2025, 4, 10, 7, 0, 0); // 10 mai 2025, 9 h à Paris
export const DEBUT_TCX = Date.UTC(2025, 3, 20, 9, 0, 0); // 20 avr. 2025
export const DEBUT_FIT = Date.UTC(2025, 5, 1, 8, 0, 0); // 1er juin 2025, 10 h à Paris

// 1 h à 30 km/h plein nord, 200 W, 140 bpm, 90 tr/min ; altitude +1 m
// toutes les 10 s pendant 30 min (D+ 180 m). pauseS : arrêt au milieu.
export function fauxGpx({ pauseS = 0, debutMs = DEBUT_GPX, nom = 'Nom dans le GPX', puissance = true } = {}) {
  const v = 30 / 3.6;
  let pts = '';
  for (let s = 0; s <= 3600; s++) {
    const t = debutMs + (s + (s > 1800 ? pauseS : 0)) * 1000;
    const lat = 45 + s * v * DEG_PAR_M;
    const ele = 100 + Math.floor(Math.min(s, 1800) / 10);
    pts += `<trkpt lat="${lat.toFixed(9)}" lon="5.5"><ele>${ele}</ele><time>${new Date(t).toISOString().replace('.000', '')}</time>`
      + `<extensions>${puissance ? '<power>200</power>' : ''}<gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr><gpxtpx:cad>90</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>\n`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
 <metadata><time>${new Date(debutMs).toISOString()}</time></metadata>
 <trk><name>${nom}</name><type>cycling</type><trkseg>
${pts} </trkseg></trk>
</gpx>`;
}

// 10 min de course à 3 m/s, 150 bpm, 250 W
export function fauxTcx() {
  let pts = '';
  for (let s = 0; s <= 600; s++) {
    pts += `<Trackpoint><Time>${new Date(DEBUT_TCX + s * 1000).toISOString()}</Time><Position><LatitudeDegrees>${(45.2 + s * 3 * DEG_PAR_M).toFixed(9)}</LatitudeDegrees><LongitudeDegrees>5.7</LongitudeDegrees></Position>`
      + `<AltitudeMeters>210.0</AltitudeMeters><DistanceMeters>${s * 3}.0</DistanceMeters><HeartRateBpm><Value>150</Value></HeartRateBpm>`
      + '<Extensions><ns3:TPX><ns3:Watts>250</ns3:Watts></ns3:TPX></Extensions></Trackpoint>\n';
  }
  // Espaces avant <?xml : défaut connu des TCX de Strava
  return `      <?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="Running"><Id>${new Date(DEBUT_TCX).toISOString()}</Id><Lap><Track>
${pts}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
}

// Itinéraire (sans horaires) : doit être ignoré
export const GPX_SANS_HORAIRES = `<?xml version="1.0"?><gpx><trk><name>Itinéraire</name><trkseg>
<trkpt lat="45.1" lon="5.1"><ele>200</ele></trkpt><trkpt lat="45.2" lon="5.2"><ele>210</ele></trkpt></trkseg></trk></gpx>`;

// ---- FIT minimal : file_id, records toutes les 10 s, session ----------

const EPOQUE_FIT_S = 631065600;
const tFit = (ms) => Math.round(ms / 1000) - EPOQUE_FIT_S;

/**
 * 1 h, sport vélo de route, 30 km, 400 m D+, 180 W moy., NP 200 W, n° de série 1234.
 */
export function fauxFit({ debutMs = DEBUT_FIT, serie = 1234 } = {}) {
  const morceaux = [];
  const ecrire = (taille, f) => { const b = new DataView(new ArrayBuffer(taille)); f(b); morceaux.push(new Uint8Array(b.buffer)); };
  const definir = (local, global, champs) => ecrire(5 + 1 + champs.length * 3, (v) => {
    v.setUint8(0, 0x40 | local); v.setUint8(1, 0); v.setUint8(2, 0); v.setUint16(3, global, true); v.setUint8(5, champs.length);
    champs.forEach(([num, taille, type], i) => { v.setUint8(6 + i * 3, num); v.setUint8(7 + i * 3, taille); v.setUint8(8 + i * 3, type); });
  });
  const donnees = (local, champs, valeurs) => {
    const taille = 1 + champs.reduce((a, c) => a + c[1], 0);
    ecrire(taille, (v) => {
      v.setUint8(0, local);
      let o = 1;
      champs.forEach(([, t, type], i) => {
        const x = valeurs[i];
        if (t === 1) v.setUint8(o, x);
        else if (t === 2) v.setUint16(o, x, true);
        else if (type === 0x85) v.setInt32(o, x, true);
        else v.setUint32(o, x, true);
        o += t;
      });
    });
  };

  const fileId = [[0, 1, 0x00], [1, 2, 0x84], [3, 4, 0x8c], [4, 4, 0x86]];
  definir(0, 0, fileId);
  donnees(0, fileId, [4, 1, serie, tFit(debutMs)]);

  const record = [[253, 4, 0x86], [0, 4, 0x85], [1, 4, 0x85], [2, 2, 0x84], [3, 1, 0x02], [5, 4, 0x86], [7, 2, 0x84]];
  definir(1, 20, record);
  const semi = (deg) => Math.round(deg * 2 ** 31 / 180);
  for (let s = 0; s <= 3600; s += 10) {
    const d = s * 30000 / 3600;
    donnees(1, record, [tFit(debutMs + s * 1000), semi(44.8 + d * DEG_PAR_M), semi(4.9), (200 + 500) * 5, 135, Math.round(d * 100), 180]);
  }

  const session = [[253, 4, 0x86], [2, 4, 0x86], [5, 1, 0x00], [6, 1, 0x00], [7, 4, 0x86], [8, 4, 0x86], [9, 4, 0x86], [22, 2, 0x84], [20, 2, 0x84], [34, 2, 0x84], [16, 1, 0x02]];
  definir(2, 18, session);
  donnees(2, session, [tFit(debutMs + 3600000), tFit(debutMs), 2, 7, 3600000, 3600000, 3000000, 400, 180, 200, 135]);

  const tailleDonnees = morceaux.reduce((a, m) => a + m.length, 0);
  const entete = new DataView(new ArrayBuffer(14));
  entete.setUint8(0, 14); entete.setUint8(1, 0x10); entete.setUint16(2, 2100, true); entete.setUint32(4, tailleDonnees, true);
  '.FIT'.split('').forEach((c, i) => entete.setUint8(8 + i, c.charCodeAt(0)));
  const res = new Uint8Array(14 + tailleDonnees + 2);
  res.set(new Uint8Array(entete.buffer), 0);
  let o = 14;
  for (const m of morceaux) { res.set(m, o); o += m.length; }
  return res;
}

// ---- activities.csv (en-têtes anglais, colonnes en double comme chez Strava)

export const CSV_STRAVA = [
  'Activity ID,Activity Date,Activity Name,Activity Type,Activity Description,Elapsed Time,Distance,Max Heart Rate,Relative Effort,Commute,Activity Private Note,Activity Gear,Filename,Athlete Weight,Bike Weight,Elapsed Time,Moving Time,Distance,Max Speed,Average Speed,Elevation Gain',
  '111,"Jun 1, 2025, 8:00:00 AM",Sortie du matin,Ride,,3600,30.00,,,false,,Canyon,activities/111.fit.gz,,,3600.0,3600.0,30000.0,,,400.0',
  '222,"May 10, 2025, 7:00:00 AM",Col du test,Ride,"Belle montée, beau temps\nretour par la vallée",3600,30.00,,,false,,Canyon,activities/222.gpx,,,3600.0,3600.0,30000.0,,,180.0',
  '333,"Apr 20, 2025, 9:00:00 AM",Footing,Run,,600,1.80,,,false,,Chaussures,activities/333.tcx.gz,,,600.0,600.0,1800.0,,,0.0',
  '444,"Feb 2, 2025, 10:00:00 AM",Fichier vide,Ride,,60,0.10,,,false,,,activities/444.gpx,,,60.0,60.0,100.0,,,0.0',
  '555,"Mar 3, 2025, 6:15:00 PM",Home trainer sans capteur,Virtual Ride,,3600,25.00,,,false,,Home trainer,,,,3600.0,3540.0,25000.0,,,0.0',
  '666,"Mar 5, 2025, 5:00:00 PM",Séance haut du corps,Weight Training,,2700,0.00,,,false,,,,,,2700.0,2700.0,0.0,,,0.0',
  '777,"Feb 8, 2025, 1:00:00 PM",Balade,Walk,,4500,5.20,,,false,,,,,,4500.0,4200.0,5200.0,,,40.0',
].join('\n') + '\n';
