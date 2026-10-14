const KEY = 'wattroom.sim-steady.v1';

/**
 * A dev build whose simulated rider holds the watts without noise: the
 * design shots set it, so BEFORE and AFTER ride the same watts and the
 * numeral's glide stays put (#4000). Never true in a built app.
 */
export function simulatedSteady(): boolean {
	if (!import.meta.env.DEV) return false;
	try {
		return localStorage.getItem(KEY) === '1';
	} catch {
		return false;
	}
}
