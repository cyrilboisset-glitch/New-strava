// Stockage local (IndexedDB) : les sorties restent sur le téléphone.
//   sorties  : résumé de chaque sortie (clé : id)
//   fichiers : octets du FIT d'origine (clé : id), pour le détail
//   reglages : petites valeurs (dossier choisi, dernier zip lu…)
//   partages : fichiers reçus par le menu Partager d'Android, en attente

const NOM = 'mes-sorties';
const VERSION = 1;

let promesseBase = null;

export function ouvrirBase() {
  if (promesseBase) return promesseBase;
  promesseBase = new Promise((resoudre, rejeter) => {
    const req = indexedDB.open(NOM, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sorties')) db.createObjectStore('sorties', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('fichiers')) db.createObjectStore('fichiers', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('reglages')) db.createObjectStore('reglages');
      if (!db.objectStoreNames.contains('partages')) db.createObjectStore('partages', { autoIncrement: true });
    };
    req.onsuccess = () => resoudre(req.result);
    req.onerror = () => rejeter(req.error);
  });
  return promesseBase;
}

function requete(r) {
  return new Promise((resoudre, rejeter) => {
    r.onsuccess = () => resoudre(r.result);
    r.onerror = () => rejeter(r.error);
  });
}

async function magasin(nom, mode = 'readonly') {
  const db = await ouvrirBase();
  return db.transaction(nom, mode).objectStore(nom);
}

export async function toutesLesSorties() {
  return requete((await magasin('sorties')).getAll());
}

export async function sortieExiste(id) {
  return (await requete((await magasin('sorties')).getKey(id))) !== undefined;
}

export async function enregistrerSortie(resume, octets) {
  const db = await ouvrirBase();
  const tx = db.transaction(['sorties', 'fichiers'], 'readwrite');
  tx.objectStore('sorties').put(resume);
  tx.objectStore('fichiers').put({ id: resume.id, octets });
  return new Promise((resoudre, rejeter) => {
    tx.oncomplete = () => resoudre();
    tx.onerror = () => rejeter(tx.error);
    tx.onabort = () => rejeter(tx.error);
  });
}

export async function lireReglage(cle) {
  return requete((await magasin('reglages')).get(cle));
}

export async function ecrireReglage(cle, valeur) {
  return requete((await magasin('reglages', 'readwrite')).put(valeur, cle));
}

export async function effacerReglage(cle) {
  return requete((await magasin('reglages', 'readwrite')).delete(cle));
}

export async function deposerPartage(nom, octets) {
  return requete((await magasin('partages', 'readwrite')).add({ nom, octets }));
}

// Récupère et vide la boîte des fichiers partagés.
export async function viderPartages() {
  const db = await ouvrirBase();
  const tx = db.transaction('partages', 'readwrite');
  const store = tx.objectStore('partages');
  const tout = await requete(store.getAll());
  store.clear();
  return tout;
}
