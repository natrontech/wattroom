/**
 * Built chunks, kept on this device (#3074): IndexedDB, one record per
 * chunk and data snapshot, expiring after 7 days and capped at 50 MB, the
 * oldest going first (docs/SPEC.md, ADR-0063: "a crew member's cached copy").
 * Every access is in try/catch and every failure is a miss: a browser that
 * keeps nothing — private windows, storage denied, a quota spent — still
 * rides, and builds each chunk again.
 */

export const TTL_MS = 7 * 24 * 3600 * 1000;
export const CAP_BYTES = 50 * 1024 * 1024;
const DB = 'wattroom-world';
// The bytes, and beside them what eviction reads: when, and how big.
const BYTES = 'chunks';
const META = 'meta';

type Meta = { id: string; at: number; size: number };

export type ChunkCache = {
	get(id: string): Promise<Uint32Array | null>;
	put(id: string, words: Uint32Array): Promise<void>;
};

const done = <T>(req: IDBRequest<T>) =>
	new Promise<T>((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});

/** A cache on `idb`, or one that remembers nothing when there is no IndexedDB to be had. */
export async function openChunkCache(
	idb: IDBFactory | undefined = globalThis.indexedDB,
	now: () => number = Date.now,
): Promise<ChunkCache> {
	let db: IDBDatabase | null = null;
	try {
		if (idb) {
			const open = idb.open(DB, 1);
			open.onupgradeneeded = () => {
				open.result.createObjectStore(BYTES);
				open.result
					.createObjectStore(META, { keyPath: 'id' })
					.createIndex('at', 'at');
			};
			db = await done(open);
		}
	} catch (err) {
		console.warn('world: chunks will not be kept on this device', err);
		db = null;
	}
	const stores = (mode: IDBTransactionMode) => {
		const tx = db!.transaction([BYTES, META], mode);
		return { bytes: tx.objectStore(BYTES), meta: tx.objectStore(META) };
	};
	// The bytes kept, read once here and kept up to date by every write.
	let total = 0;
	if (db)
		try {
			const rows = (await done(stores('readonly').meta.getAll())) as Meta[];
			const stale = rows.filter((r) => now() - r.at > TTL_MS);
			total = rows.reduce((n, r) => n + r.size, 0);
			if (stale.length > 0) await forget(stale);
		} catch {
			db = null;
		}

	return {
		async get(id) {
			if (!db) return null;
			try {
				const s = stores('readonly');
				const [meta, bytes] = await Promise.all([
					done(s.meta.get(id)) as Promise<Meta | undefined>,
					done(s.bytes.get(id)) as Promise<ArrayBuffer | undefined>,
				]);
				if (!meta || !bytes) return null;
				if (now() - meta.at > TTL_MS) {
					await forget([meta]);
					return null;
				}
				return new Uint32Array(bytes);
			} catch {
				return null;
			}
		},
		async put(id, words) {
			if (!db) return;
			try {
				const bytes = words.slice().buffer;
				const s = stores('readwrite');
				const old = (await done(s.meta.get(id))) as Meta | undefined;
				await Promise.all([
					done(s.bytes.put(bytes, id)),
					done(s.meta.put({ id, at: now(), size: bytes.byteLength })),
				]);
				total += bytes.byteLength - (old?.size ?? 0);
				if (total > CAP_BYTES) await evict();
			} catch {
				/* a chunk not kept is a chunk built again */
			}
		},
	};

	/** The oldest go first, until the rest fits the cap. */
	async function evict() {
		const s = stores('readwrite');
		const cursor = s.meta.index('at').openCursor();
		await new Promise<void>((resolve, reject) => {
			cursor.onerror = () => reject(cursor.error);
			cursor.onsuccess = () => {
				const c = cursor.result;
				if (!c || total <= CAP_BYTES) return resolve();
				const row = c.value as Meta;
				s.bytes.delete(row.id);
				c.delete();
				total -= row.size;
				c.continue();
			};
		});
	}

	async function forget(rows: Meta[]) {
		const s = stores('readwrite');
		await Promise.all(
			rows.flatMap((r) => [
				done(s.bytes.delete(r.id)),
				done(s.meta.delete(r.id)),
			]),
		);
		total -= rows.reduce((n, r) => n + r.size, 0);
	}
}
