// Relecture du fichier d'origine d'une sortie (gardé dans IndexedDB) pour
// le détail : FIT, GPX ou TCX, compressé .gz ou non.
import { lireFit } from './fit.js';
import { lireGpx, lireTcx } from './trace.js';

export async function degzip(octets) {
  const flux = new Blob([octets]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(flux).arrayBuffer();
}

/**
 * @param {{octets: ArrayBuffer, format?: 'fit'|'gpx'|'tcx', gzip?: boolean}} fichier
 *   (les sorties importées avant la v0.2 n'ont ni format ni gzip : FIT brut)
 * @returns {Promise<{records: object[], tours: object[]}>}
 */
export async function decoderFichier(fichier) {
  const brut = fichier.gzip ? await degzip(fichier.octets) : fichier.octets;
  const format = fichier.format ?? 'fit';
  if (format === 'fit') {
    const fit = lireFit(brut);
    return { records: fit.records, tours: fit.laps };
  }
  const texte = new TextDecoder().decode(brut);
  const lu = format === 'gpx' ? lireGpx(texte) : lireTcx(texte);
  return { records: lu.records, tours: [] };
}
