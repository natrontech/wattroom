/**
 * What /ride remembers on this device (#3671): the road and the workout last
 * ridden alone, so the Ride card opens on them — “your last road”, “Last:
 * Sweet Spot 2×20”. Per device, as the lounge door is; a browser that keeps
 * nothing remembers nothing, and the card opens on no road.
 */
const KEY = 'wattroom.last-ride.v1';

type Remembered = { road?: string; workout?: string };

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
		// Nothing kept: the card opens on no road.
	}
}

export const lastRoad = (): string | undefined => read().road;
export const lastWorkout = (): string | undefined => read().workout;

export function rememberRoad(id: string) {
	write({ ...read(), road: id });
}

export function rememberWorkout(id: string) {
	write({ ...read(), workout: id });
}
