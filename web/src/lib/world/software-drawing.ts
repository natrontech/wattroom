const SOFTWARE_KEY = 'wattroom.world-software.v1';

/**
 * A dev build on a machine that draws the world in software (the design
 * shots on a GPU-less box, #3823) misses every frame by design; this keeps
 * the frame judge from sending that ride to the Skyline. Never true in a
 * built app: a rider's own slow screen still falls back.
 */
export function softwareDrawing(): boolean {
	if (!import.meta.env.DEV) return false;
	try {
		return localStorage.getItem(SOFTWARE_KEY) === '1';
	} catch {
		return false;
	}
}
