/**
 * The World control (#3214, ADR-0079): how much the world moves on this
 * device. Null while the rider never chose; reduced motion then opens on Flat.
 */
export type WorldMode = 'full' | 'steady' | 'light' | 'flat';

export const WORLD_MODES: { mode: WorldMode; label: string; line: string }[] = [
	{ mode: 'full', label: 'Full', line: 'the world as designed' },
	{
		mode: 'steady',
		label: 'Steady',
		line: 'the heli camera only, a fixed FOV, cuts, no particles',
	},
	{ mode: 'light', label: 'Light', line: 'the lowest 3D tier' },
	{ mode: 'flat', label: 'Flat', line: 'the Skyline' },
];

const KEY = 'wattroom.world.mode.v1';

export function worldMode(): WorldMode | null {
	try {
		const v = localStorage.getItem(KEY);
		return WORLD_MODES.some((m) => m.mode === v) ? (v as WorldMode) : null;
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
