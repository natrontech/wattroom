/**
 * The music pool, client side (#268, ADR-0015): one global library every
 * signed-in rider browses and uploads to.
 *
 * The fetch goes through `$lib/api` like everything else; what lives here is
 * the shape and the two things worth stating once — how a track is labelled
 * when its tags are thin, and what "MP3 only" means before a byte is sent.
 */
import { api } from '$lib/api';

export interface Track {
	id: string;
	title: string;
	artist?: string;
	album?: string;
	durationMs: number;
	sizeBytes: number;
	bpm?: number;
	tags: string[];
	uploadedBy?: string;
	createdAt: string;
}

/** A shelf label: a tag in the pool and how many tracks wear it. */
export interface PoolTag {
	tag: string;
	tracks: number;
}

/** The pool is capped per rider at 2 GB; the server is the one that enforces it. */
export const MAX_UPLOAD_BYTES = 48 << 20;

export const audioSrc = (id: string) => `/api/tracks/${id}/audio`;

/**
 * Refused before the upload starts rather than after 48 MB of it. The server
 * checks the same two things by reading the file's frames — this only saves a
 * rider the wait, so it errs generous: anything claiming to be an MP3 goes.
 */
export function whyNotUploadable(file: File): string | null {
	const looksMp3 =
		file.type === 'audio/mpeg' || file.name.toLowerCase().endsWith('.mp3');
	if (!looksMp3) return `${file.name} is not an MP3.`;
	if (file.size > MAX_UPLOAD_BYTES) {
		return `${file.name} is over 48 MB.`;
	}
	if (file.size === 0) return `${file.name} is empty.`;
	return null;
}

export function listTracks(query: string, tag = '') {
	const params = new URLSearchParams();
	if (query.trim()) params.set('q', query.trim());
	if (tag) params.set('tag', tag);
	const qs = params.toString();
	return api<{ tracks: Track[]; tags: PoolTag[] }>(
		`/api/tracks${qs ? `?${qs}` : ''}`,
	);
}

export function uploadTrack(file: File) {
	return api<Track>(`/api/tracks?name=${encodeURIComponent(file.name)}`, {
		method: 'POST',
		body: file,
	});
}

export function saveTrack(
	id: string,
	fields: {
		title: string;
		artist: string;
		album: string;
		bpm: number | null;
		tags: string[];
	},
) {
	return api<Track>(`/api/tracks/${id}`, { method: 'PATCH', json: fields });
}

export function deleteTrack(id: string) {
	return api<null>(`/api/tracks/${id}`, { method: 'DELETE' });
}

/**
 * Tags are typed as one comma-separated line, and normalized the way the
 * server will normalize them — so the chips a rider sees after saving are the
 * chips the field showed them, rather than a lower-cased surprise.
 *
 * ADR-0015: free-form, not a taxonomy. Nothing here rejects a tag; it only
 * agrees with the server about when two of them are the same one.
 */
export function parseTags(line: string): string[] {
	const seen = new Set<string>();
	for (const raw of line.split(',')) {
		const tag = raw.trim().toLowerCase().split(/\s+/).join(' ').slice(0, 40);
		if (tag) seen.add(tag);
	}
	return [...seen].slice(0, 20);
}

/** m:ss, the way every other duration in the app reads. */
export function trackClock(ms: number): string {
	const total = Math.round(ms / 1000);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** "12.4 MB" — a size a rider can weigh against a 2 GB allowance. */
export function trackSize(bytes: number): string {
	const mb = bytes / (1 << 20);
	return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}
