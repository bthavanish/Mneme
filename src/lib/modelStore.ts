/**
 * Mneme - local camera memory
 * License: Apache 2.0
 * github.com/bthavanish/Mneme
 *
 * modelStore.ts - IndexedDB storage for ML model files
 * downloads models from CDN and caches them locally
 */

const DB_NAME = 'mneme-models';
const DB_VERSION = 1;
const STORE_NAME = 'models';

export interface ModelFile {
  id: string;
  data: ArrayBuffer;
  type: string;
  downloadedAt: number;
}

const REMOTE_MODEL_PREFIX = 'remote-model:';
let nativeFetch: typeof window.fetch | null = null;
let progressListener: ((progress: DownloadProgress) => void) | undefined;
const pendingCacheWrites = new Set<Promise<void>>();
const virtualModelFiles = new Map<string, { data: ArrayBuffer | string; type: string }>();

function remoteModelId(url: string): string {
  return `${REMOTE_MODEL_PREFIX}${url}`;
}

export interface DownloadProgress {
  loaded: number;
  total: number;
  percent: number;
  speed: number;
  eta: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveModelFile(id: string, data: ArrayBuffer, type: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id, data, type, downloadedAt: Date.now() });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function loadModelFile(id: string): Promise<ArrayBuffer | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => { db.close(); resolve(req.result?.data || null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function deleteModelFile(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function isModelStored(id: string): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).count(id);
    req.onsuccess = () => { db.close(); resolve(req.result > 0); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function hasValidModelFile(id: string, minimumBytes: number): Promise<boolean> {
  const data = await loadModelFile(id);
  return data !== null && data.byteLength >= minimumBytes;
}

export async function getModelBlobUrl(id: string): Promise<string | null> {
  const data = await loadModelFile(id);
  if (!data) return null;
  const blob = new Blob([data]);
  return URL.createObjectURL(blob);
}

/**
 * Makes model-library fetches persistent. TensorFlow and coco-ssd request a
 * model manifest followed by weight shards; caching at fetch level preserves
 * exactly those files and lets the libraries continue to use their normal
 * loaders on subsequent visits.
 */
export function installModelFetchCache(onProgress?: (progress: DownloadProgress) => void): void {
  progressListener = onProgress;
  if (nativeFetch) return;
  nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const virtual = virtualModelFiles.get(requestUrl);
    if (virtual) return new Response(virtual.data, { status: 200, headers: { 'content-type': virtual.type } });
    // Only cache model assets; app/API requests retain normal fetch behaviour.
    const isModelAsset = /(?:tfjs-models|tensorflow|coco-ssd|face-api|model\.json|weights_manifest|\.bin(?:\?|$)|shard\d*(?:\?|$))/.test(requestUrl);
    if (!isModelAsset) return nativeFetch!(input, init);

    const id = remoteModelId(requestUrl);
    const cached = await loadModelFile(id);
    if (cached) return new Response(cached, { status: 200 });

    const response = await nativeFetch!(input, init);
    if (!response.ok || !response.body || (init?.method && init.method !== 'GET')) return response;

    const cacheCopy = response.clone();
    const write = cacheResponse(id, cacheCopy, response.headers.get('content-type') || 'application/octet-stream', (p) => progressListener?.(p));
    pendingCacheWrites.add(write);
    void write.finally(() => pendingCacheWrites.delete(write));
    return response;
  };
}

/**
 * Expose one stored manifest and its shard at normal HTTPS-like URLs. face-api
 * resolves relative weight paths from a manifest URL, which blob URLs cannot
 * support reliably.
 */
export function registerStoredModelManifest(manifestData: ArrayBuffer, shardData: ArrayBuffer): { uri: string; dispose: () => void } {
  const base = `https://mneme.local/models/${crypto.randomUUID()}`;
  const manifestUri = `${base}/manifest.json`;
  const shardUri = `${base}/weights.bin`;
  const manifest = JSON.parse(new TextDecoder().decode(manifestData));
  for (const group of manifest) group.paths = ['weights.bin'];
  virtualModelFiles.set(manifestUri, { data: JSON.stringify(manifest), type: 'application/json' });
  virtualModelFiles.set(shardUri, { data: shardData, type: 'application/octet-stream' });
  return { uri: manifestUri, dispose: () => { virtualModelFiles.delete(manifestUri); virtualModelFiles.delete(shardUri); } };
}

export function setModelDownloadProgressListener(listener?: (progress: DownloadProgress) => void): void {
  progressListener = listener;
}

/** Wait until every model response started by the library is durable in IndexedDB. */
export async function flushModelCache(): Promise<void> {
  while (pendingCacheWrites.size) await Promise.all([...pendingCacheWrites]);
}

async function cacheResponse(id: string, response: Response, type: string, onProgress?: (progress: DownloadProgress) => void): Promise<void> {
  try {
    const startTime = performance.now();
    const total = parseInt(response.headers.get('content-length') || '0', 10);
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      const elapsed = Math.max((performance.now() - startTime) / 1000, 0.001);
      const knownTotal = total || received;
      onProgress?.({ loaded: received, total: knownTotal, percent: Math.round(received / knownTotal * 100), speed: received / elapsed, eta: total ? Math.max(0, total - received) / (received / elapsed) : 0 });
    }
    const data = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    await saveModelFile(id, data.buffer, type);
  } catch (error) {
    // Model loading is still allowed to succeed when browser storage is full.
    console.warn('[mneme] could not cache model asset', error);
  }
}

export async function downloadModelFile(
  url: string,
  id: string,
  type: string,
  onProgress?: (p: DownloadProgress) => void
): Promise<void> {
  const startTime = performance.now();
  // Use the original fetch when the persistent model interceptor is installed.
  // This prevents a stale intercepted response from being copied back into a
  // repaired local model record.
  const response = await (nativeFetch ? nativeFetch(url) : fetch(url));
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);

  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;

    const elapsed = (performance.now() - startTime) / 1000;
    const speed = received / elapsed;
    const total = contentLength || received;
    const percent = Math.round((received / total) * 100);
    const remaining = total - received;
    const eta = speed > 0 ? remaining / speed : 0;

    onProgress?.({ loaded: received, total, percent, speed, eta });
  }

  const totalSize = chunks.reduce((a, c) => a + c.length, 0);
  const data = new ArrayBuffer(totalSize);
  const view = new Uint8Array(data);
  let offset = 0;
  for (const chunk of chunks) {
    view.set(chunk, offset);
    offset += chunk.length;
  }

  await saveModelFile(id, data, type);
}

export async function clearAllModels(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function hasCachedModelMatching(fragment: string): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAllKeys();
    req.onsuccess = () => { db.close(); resolve(req.result.some(key => String(key).includes(fragment))); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function deleteCachedModelsMatching(fragment: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAllKeys();
    req.onsuccess = () => { for (const key of req.result) if (String(key).includes(fragment)) store.delete(key); };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
