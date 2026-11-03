/**
 * House radio's Records style: real lofi hip hop, CC0 tracks the server keeps
 * on its own shelf. records.json is the credits list, one entry per track
 * with its title, artist, source and licence; scripts/house-radio.py builds
 * the files from it. Every screen in a voice channel plays the same second:
 * the record and how far into it follow from the crew and the server clock,
 * the way the generated styles do (station.ts).
 */
import RECORDS from '$lib/lounge/records.json';
import { hashSeed, prng } from '$lib/world/rand';

export interface Record {
	file: string;
	title: string;
	artist: string;
	url: string;
	licence: string;
	ms: number;
}

/** A breath between records, so one never runs straight into the next. */
const GAP_SEC = 2;

export const radioSrc = (file: string) => `/api/radio/${file}`;

export interface RecordPosition {
	record: Record;
	/** Seconds into the record; past its length is the gap after it. */
	at: number;
}

/**
 * The record a crew's station plays at server time `sec`. Each lap through
 * the shelf is shuffled again, seeded by crew and lap.
 */
// ponytail: a lap may open on the record the last one ended with (1 in 44).
export function recordAt(
	station: string,
	sec: number,
	shelf: readonly Record[] = RECORDS,
): RecordPosition {
	const lap = shelf.reduce((s, r) => s + r.ms / 1000 + GAP_SEC, 0);
	const round = Math.floor(sec / lap);
	const order = [...shelf];
	const r = prng(hashSeed(`${station}:${round}`));
	for (let i = order.length - 1; i > 0; i--) {
		const j = Math.floor(r() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}
	let at = sec - round * lap;
	for (const record of order) {
		const len = record.ms / 1000 + GAP_SEC;
		if (at < len) return { record, at };
		at -= len;
	}
	return { record: order[order.length - 1], at };
}
