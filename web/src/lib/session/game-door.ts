/**
 * A game asked for from outside the channel (#3276): /ride's game door sends
 * the rider to the lounge with the mode in the address, once. SessionLayers
 * starts it the way its own picker does, then takes the mode off the address
 * so a reload finds nothing to start again.
 */
const PARAM = 'game';

/** The lounge's address, asking for this game. */
export function gameDoor(home: string, mode: string): string {
	return `${home}?${PARAM}=${encodeURIComponent(mode)}`;
}

/** The game this address asks for, and the address without it; null for none. */
export function takeGameDoor(url: URL): { mode: string; rest: URL } | null {
	const mode = url.searchParams.get(PARAM);
	if (!mode) return null;
	const rest = new URL(url);
	rest.searchParams.delete(PARAM);
	return { mode, rest };
}
