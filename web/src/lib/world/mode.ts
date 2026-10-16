/**
 * The World control (#3214, ADR-0079): 3D or the flat road on this device,
 * and how much the world moves. Null while the rider never chose, which rides
 * Flat: 3D is the rider's to turn on (#3084, ADR-0066 amended).
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
	{ mode: 'light', label: 'Light', line: 'the lowest 3D tier' },
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
