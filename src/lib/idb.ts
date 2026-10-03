/**
 * Маленькое хранилище «ключ → значение» в IndexedDB. localStorage ограничен ~5 МБ,
 * а медиатека с компьютера и журнал прослушиваний могут быть больше.
 * Подходит как storage для zustand/persist.
 */
import type { StateStorage } from 'zustand/middleware';

const DB = 'frost';
const STORE = 'kv';
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? req.error);
  });
}

export const idbGet = <T>(key: string) => run<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
export const idbSet = (key: string, value: unknown) => run('readwrite', (s) => s.put(value, key)).then(() => undefined);
export const idbDel = (key: string) => run('readwrite', (s) => s.delete(key)).then(() => undefined);
export const idbKeys = () => run<IDBValidKey[]>('readonly', (s) => s.getAllKeys()).then((keys) => keys.map(String));

/** Для zustand/persist. Если IndexedDB недоступна, работает через localStorage. */
export const idbStorage: StateStorage = {
  getItem: async (name) => {
    try {
      return (await idbGet<string>(name)) ?? null;
    } catch {
      return localStorage.getItem(name);
    }
  },
  setItem: async (name, value) => {
    try {
      await idbSet(name, value);
    } catch {
      try {
        localStorage.setItem(name, value);
      } catch {
        /* нет места: данные останутся в памяти до перезапуска */
      }
    }
  },
  removeItem: async (name) => {
    try {
      await idbDel(name);
    } catch {
      localStorage.removeItem(name);
    }
  },
};
