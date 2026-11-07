/**
 * The World control (#3214, ADR-0079): 3D or the flat road on this device,
 * and how much the world moves. Null while the rider never chose, which rides
 * the world: Flat is for a machine that cannot draw it, or a rider who asks.
 */
export type WorldMode = 'full' | 'steady' | 'light' | 'flat';

export const WORLD_MODES: { mode: WorldMode; label: string; line: string }[] = [
	{
		mode: 'flat',
		label: 'Flat',
		line: 'the road as a 2D profile, the Skyline',
	},
	{ mode: 'full', label: 'Full', line: 'the 3D world as designed' },
	{
		mode: 'steady',
		label: 'Steady',
		line: 'the heli camera only, a fixed FOV, cuts, no particles',
	},
	{ mode: 'light', label: 'Low', line: 'the lowest 3D tier' },
];

const KEY = 'wattroom.world.mode.v1';
/** The world-slot flag /dev/world set before the World control held 3D (#3031). */
const OLD_SLOT_KEY = 'wattroom.world-slot.v1';

export function worldMode(): WorldMode | null {
	try {
		const v = localStorage.getItem(KEY);
		if (WORLD_MODES.some((m) => m.mode === v)) return v as WorldMode;
		// A browser that had the old flag on keeps its world, once (#3084).
		if (localStorage.getItem(OLD_SLOT_KEY) === null) return null;
		const was = localStorage.getItem(OLD_SLOT_KEY) === '1' ? 'full' : null;
		localStorage.removeItem(OLD_SLOT_KEY);
		if (was) localStorage.setItem(KEY, was);
		return was;
	} catch {
		return null;
	}
}

export function setWorldMode(mode: WorldMode): void {
	try {
		localStorage.setItem(KEY, mode);
	} catch {
		/* a browser that keeps nothing keeps the default */
	}
}

const LOOK_KEY = 'wattroom.world.pixels.v1';

/**
 * Diorama 3D (diorama.ts) on this device: every ride's, until the rider
 * picks Smooth ('0'). Pixel 3D's '1' rides Diorama: that look is gone.
 */
export function worldDiorama(): boolean {
	try {
		return localStorage.getItem(LOOK_KEY) !== '0';
	} catch {
		return true;
	}
}

export function setWorldDiorama(on: boolean): void {
	try {
		localStorage.setItem(LOOK_KEY, on ? 'd' : '0');
	} catch {
		/* a browser that keeps nothing keeps the default */
	}
}
