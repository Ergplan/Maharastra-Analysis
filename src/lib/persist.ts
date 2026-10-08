// Minimal IndexedDB key-value store for saved scenarios (no dependencies).
const DB = 'captive-solar-studio', STORE = 'scenarios';
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
}
export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  await new Promise<void>((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(value, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readonly'); const r = tx.objectStore(STORE).get(key); r.onsuccess = () => res(r.result as T); r.onerror = () => rej(r.error); });
}
export async function idbKeys(): Promise<string[]> {
  const db = await open();
  return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readonly'); const r = tx.objectStore(STORE).getAllKeys(); r.onsuccess = () => res(r.result.map(String)); r.onerror = () => rej(r.error); });
}
export async function idbDel(key: string): Promise<void> {
  const db = await open();
  await new Promise<void>((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
