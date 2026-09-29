/**
 * The lounge (#3274): the voice channel a rider rides in when their crew may
 * drop in — the door beside "Ride alone" on /ride and Home. Defined once,
 * here: the voice channel you last rode in for that crew, or else the crew's
 * first voice channel by position (the crews' live read lists them in
 * position order, ListCrewChannels).
 *
 * What it remembers is this device's: which crew a rider in several picked,
 * where they last rode in each, and which door they took last. Storage can
 * be missing or refuse (a private window); every read falls back to the rule.
 */
import type { LiveChannel, LiveCrew } from '$lib/crews-live';

const KEY = 'wattroom.lounge.v1';

interface Remembered {
	/** The crew a rider in several picked for the lounge door. */
	crew?: string;
	/** crew id → the voice channel last ridden in it. */
	rodeIn?: Record<string, string>;
	/** The door taken last. */
	door?: Door;
}

export type Door = 'alone' | 'lounge';

function read(): Remembered {
	try {
		const raw = localStorage.getItem(KEY);
		return raw ? (JSON.parse(raw) as Remembered) : {};
	} catch {
		return {};
	}
}

function write(next: Remembered) {
	try {
		localStorage.setItem(KEY, JSON.stringify(next));
	} catch {
		// Nothing kept: the rule answers without it.
	}
}

/** The lounge of one crew: last ridden, else first by position. */
export function lounge(
	crew: LiveCrew,
	lastRidden = read().rodeIn?.[crew.id],
): LiveChannel | undefined {
	const voice = crew.channels.filter((c) => c.kind === 'voice');
	return voice.find((c) => c.id === lastRidden) ?? voice[0];
}

/**
 * The crew the door is for: the one picked, while the rider is still in it,
 * else the first crew that has a voice channel to ride in.
 */
export function loungeCrew(crews: readonly LiveCrew[]): LiveCrew | undefined {
	const riding = crews.filter((crew) => lounge(crew, undefined));
	const picked = read().crew;
	return riding.find((crew) => crew.id === picked) ?? riding[0];
}

/**
 * Whether a rider sees the two doors at all: while the read is out (a
 * skeleton, not a door that vanishes), when it failed with nothing to show
 * (riding alone stays a tap, and the failure is said), and whenever a crew of
 * theirs has a voice channel. Without one there is only riding alone, which
 * needs no choice.
 */
export function doorsFor(live: {
	loaded: boolean;
	error: string | null;
	crews: readonly LiveCrew[];
}): boolean {
	if (!live.loaded) return true;
	if (loungeCrew(live.crews)) return true;
	return live.error !== null && live.crews.length === 0;
}

/** Noted when a rider rides in a voice channel — a free ride or a session. */
export function rememberRodeIn(crew: string, channel: string) {
	const now = read();
	if (now.rodeIn?.[crew] === channel) return;
	write({ ...now, rodeIn: { ...now.rodeIn, [crew]: channel } });
}

export function rememberCrew(crew: string) {
	write({ ...read(), crew });
}

export function lastDoor(): Door | undefined {
	return read().door;
}

export function rememberDoor(door: Door) {
	write({ ...read(), door });
}
