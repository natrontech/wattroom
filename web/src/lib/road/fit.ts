import type { TrackPoint } from './parse';

/**
 * A FIT course becomes points (#3058): Garmin's binary format, read just far
 * enough for a route — every record message's position and height, and the
 * file_id's manufacturer. A course carries its track as record messages, and
 * so does a ride a rider picks instead, so both come through the same door.
 *
 * Numbers from the FIT profile: file_id is message 0 (manufacturer, field 1);
 * record is message 20 (position_lat 0, position_long 1 in semicircles;
 * altitude 2 and enhanced_altitude 78, both ÷5 − 500 m).
 *
 * ponytail: the file's CRC is not checked — the header's data size bounds
 * every read, and a corrupt position still has to pass the route pipeline's
 * own checks. Add it when a real file is found that needs it.
 */

/** Strava, in the FIT profile's manufacturer list: its exports ride owner-only (ADR-0063). */
const MANUFACTURER_STRAVA = 265;

const FILE_ID = 0;
const RECORD = 20;
const SEMICIRCLE_DEG = 180 / 2 ** 31;

export type FitRead =
	{ points: TrackPoint[]; strava: boolean } | { refused: string };

/** Whether these bytes open like a FIT file: ".FIT" at bytes 8–11. */
export function isFit(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 12 &&
		bytes[8] === 0x2e &&
		bytes[9] === 0x46 &&
		bytes[10] === 0x49 &&
		bytes[11] === 0x54
	);
}

type Definition = {
	global: number;
	little: boolean;
	fields: { num: number; size: number }[];
	devSize: number;
};

const NOT_FIT =
	'This file is not a FIT course. Export the course from your planner or device as FIT, GPX or TCX, and pick that file.';
const CUT_SHORT =
	'This FIT file ends in the middle of a message. Export the course again, and pick the new file.';

export function readFit(bytes: Uint8Array): FitRead {
	if (!isFit(bytes)) return { refused: NOT_FIT };
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const headerSize = bytes[0];
	const end = headerSize + view.getUint32(4, true);
	if ((headerSize !== 12 && headerSize !== 14) || end > bytes.length)
		return { refused: CUT_SHORT };

	const defs = new Map<number, Definition>();
	const points: TrackPoint[] = [];
	let strava = false;
	let at = headerSize;
	while (at < end) {
		const header = bytes[at++];
		if (header & 0x80) {
			// A compressed-timestamp header: a data message of local type 0–3.
			const def = defs.get((header >> 5) & 0x03);
			if (!def) return { refused: CUT_SHORT };
			at = readData(def, at);
		} else if (header & 0x40) {
			if (at + 5 > end) return { refused: CUT_SHORT };
			const little = bytes[at + 1] === 0;
			const global = view.getUint16(at + 2, little);
			const count = bytes[at + 4];
			at += 5;
			const fields: Definition['fields'] = [];
			for (let i = 0; i < count; i++, at += 3)
				fields.push({ num: bytes[at], size: bytes[at + 1] });
			let devSize = 0;
			if (header & 0x20) {
				const devCount = bytes[at++];
				for (let i = 0; i < devCount; i++, at += 3) devSize += bytes[at + 1];
			}
			if (at > end) return { refused: CUT_SHORT };
			defs.set(header & 0x0f, { global, little, fields, devSize });
		} else {
			const def = defs.get(header & 0x0f);
			if (!def) return { refused: CUT_SHORT };
			at = readData(def, at);
		}
		if (at > end) return { refused: CUT_SHORT };
	}
	if (points.length === 0)
		return {
			refused:
				'This FIT file has no positions — a workout, or a ride recorded indoors. Export a course, or a ride with GPS, and pick that file.',
		};
	return { points, strava };

	/** One data message: the fields a route needs, the rest stepped over. */
	function readData(def: Definition, start: number): number {
		const size = def.fields.reduce((sum, f) => sum + f.size, 0) + def.devSize;
		if (start + size > end) return end + 1;
		let lat = NaN;
		let lon = NaN;
		let ele = NaN;
		let enhanced = NaN;
		let offset = start;
		for (const f of def.fields) {
			if (def.global === RECORD) {
				if (f.num === 0 && f.size === 4) lat = semicircles(offset);
				else if (f.num === 1 && f.size === 4) lon = semicircles(offset);
				else if (f.num === 2 && f.size === 2) {
					const v = view.getUint16(offset, def.little);
					if (v !== 0xffff) ele = v / 5 - 500;
				} else if (f.num === 78 && f.size === 4) {
					const v = view.getUint32(offset, def.little);
					if (v !== 0xffffffff) enhanced = v / 5 - 500;
				}
			} else if (def.global === FILE_ID && f.num === 1 && f.size === 2) {
				strava = view.getUint16(offset, def.little) === MANUFACTURER_STRAVA;
			}
			offset += f.size;
		}
		if (def.global === RECORD && Number.isFinite(lat) && Number.isFinite(lon))
			points.push({
				lat,
				lon,
				ele: Number.isFinite(enhanced) ? enhanced : ele,
			});
		return start + size;

		function semicircles(o: number): number {
			const v = view.getInt32(o, def.little);
			return v === 0x7fffffff ? NaN : v * SEMICIRCLE_DEG;
		}
	}
}
