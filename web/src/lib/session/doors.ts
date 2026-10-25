import type { PickerIntent } from '$lib/channel/context';

/**
 * Doors into a voice channel from outside it: an address that asks the
 * channel for one thing, once. SessionLayers does it, then takes the ask off
 * the address so a reload finds nothing to do again.
 */
const GAME = 'game';
const PICKER = 'picker';
const PICK = 'pick';
const INTENTS: readonly PickerIntent[] = ['start', 'plan', 'ride'];

function without(url: URL, ...params: string[]): URL {
	const rest = new URL(url);
	for (const param of params) rest.searchParams.delete(param);
	return rest;
}

/** /ride's game door (#3276): the lounge's address, asking for this game. */
export function gameDoor(home: string, mode: string): string {
	return `${home}?${GAME}=${encodeURIComponent(mode)}`;
}

/** The game this address asks for, and the address without it; null for none. */
export function takeGameDoor(url: URL): { mode: string; rest: URL } | null {
	const mode = url.searchParams.get(GAME);
	return mode ? { mode, rest: without(url, GAME) } : null;
}

/**
 * The editor, opened from a picker at `here` (#4082): its way back reopens
 * the picker with the same question, so a one-off workout never sends the
 * rider looking for their channel again.
 */
export function buildFromPicker(here: URL, intent: PickerIntent): string {
	const back = without(here, PICK);
	back.searchParams.set(PICKER, intent);
	return `/workouts/edit?back=${encodeURIComponent(back.pathname + back.search)}`;
}

/** The editor's way back: a path on this site, never another origin. */
export function backFrom(url: URL): string | null {
	const raw = url.searchParams.get('back');
	if (!raw?.startsWith('/')) return null;
	const back = new URL(raw, url);
	return back.origin === url.origin ? back.pathname + back.search : null;
}

/** The way back, opening the picker on the workout just saved. */
export function withPick(back: string, id: string): string {
	const url = new URL(back, 'http://x');
	url.searchParams.set(PICK, id);
	return url.pathname + url.search;
}

/** The picker this address asks for, and the address without it; null for none. */
export function takePickerDoor(
	url: URL,
): { intent: PickerIntent; pick?: string; rest: URL } | null {
	const intent = INTENTS.find((i) => i === url.searchParams.get(PICKER));
	if (!intent) return null;
	return {
		intent,
		pick: url.searchParams.get(PICK) ?? undefined,
		rest: without(url, PICKER, PICK),
	};
}
