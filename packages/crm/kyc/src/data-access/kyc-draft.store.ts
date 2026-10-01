import { Injectable, signal } from '@angular/core';

/**
 * Brouillon d'enrôlement, chiffré dans le navigateur.
 *
 * Exigence du cahier (définition de terminé) : « aucune donnée sensible n'est conservée dans le
 * navigateur hors brouillon chiffré », et KYC-F-01 veut une reprise après coupure — donc une
 * persistance qui survit à un rechargement.
 *
 * **Ce que cette implémentation protège, et ce qu'elle ne protège pas.** La clé AES-GCM est générée
 * `extractable: false` et rangée dans IndexedDB : aucun script, console comprise, ne peut la relire,
 * si bien qu'une copie du `localStorage` est inexploitable. En revanche, du code s'exécutant dans
 * l'origine peut toujours *demander* un déchiffrement. C'est donc une protection contre
 * l'exfiltration du stockage, pas contre un script hostile déjà en place — et c'est la limite réelle
 * de tout chiffrement côté navigateur. À ne pas présenter comme davantage.
 */

const DB_NAME = 'sankore-kyc';
const KEY_STORE = 'keys';
const KEY_ID = 'draft-key';
const DRAFT_PREFIX = 'kyc-draft:';

interface EncryptedPayload {
  iv: number[];
  data: number[];
  savedAt: string;
}

@Injectable({ providedIn: 'root' })
export class KycDraftStore {
  /** Dernier enregistrement réussi, affiché à l'agent (« Brouillon enregistré il y a 2 min »). */
  public readonly lastSavedAt = signal<string | null>(null);
  public readonly isUnavailable = signal(false);

  private _keyPromise: Promise<CryptoKey> | null = null;

  public async save(draftId: string, value: unknown): Promise<void> {
    try {
      const key = await this._key();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(JSON.stringify(value));
      const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
      const payload: EncryptedPayload = {
        iv: Array.from(iv),
        data: Array.from(new Uint8Array(cipher)),
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(DRAFT_PREFIX + draftId, JSON.stringify(payload));
      this.lastSavedAt.set(payload.savedAt);
    } catch {
      // Navigation privée, stockage plein, Web Crypto indisponible : on le dit plutôt que de laisser
      // croire que le brouillon est à l'abri.
      this.isUnavailable.set(true);
    }
  }

  public async load<T>(draftId: string): Promise<T | null> {
    try {
      const raw = localStorage.getItem(DRAFT_PREFIX + draftId);
      if (!raw) return null;
      const payload = JSON.parse(raw) as EncryptedPayload;
      const key = await this._key();
      const clear = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(payload.iv) },
        key,
        new Uint8Array(payload.data),
      );
      this.lastSavedAt.set(payload.savedAt);
      return JSON.parse(new TextDecoder().decode(clear)) as T;
    } catch {
      // Clé perdue (site data effacé) : le brouillon est définitivement illisible, on le retire au
      // lieu de le laisser échouer à chaque ouverture.
      this.discard(draftId);
      return null;
    }
  }

  public discard(draftId: string): void {
    try {
      localStorage.removeItem(DRAFT_PREFIX + draftId);
    } catch {
      /* rien à faire : le brouillon n'était de toute façon pas lisible */
    }
    this.lastSavedAt.set(null);
  }

  public listDraftIds(): string[] {
    try {
      return Object.keys(localStorage)
        .filter((k) => k.startsWith(DRAFT_PREFIX))
        .map((k) => k.slice(DRAFT_PREFIX.length));
    } catch {
      return [];
    }
  }

  /** Clé non extractible, créée une fois puis relue depuis IndexedDB. */
  private _key(): Promise<CryptoKey> {
    this._keyPromise ??= this._loadOrCreateKey();
    return this._keyPromise;
  }

  private async _loadOrCreateKey(): Promise<CryptoKey> {
    const existing = await this._readKey();
    if (existing) return existing;

    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await this._writeKey(key);
    return key;
  }

  private _openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(KEY_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async _readKey(): Promise<CryptoKey | null> {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(KEY_STORE, 'readonly').objectStore(KEY_STORE).get(KEY_ID);
      request.onsuccess = () => resolve((request.result as CryptoKey) ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  private async _writeKey(key: CryptoKey): Promise<void> {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(KEY_STORE, 'readwrite').objectStore(KEY_STORE).put(key, KEY_ID);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
