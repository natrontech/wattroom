import type { ObcAction } from '$lib/ble/obc';
import { rideKeyOf, shiftOf, type RideKey } from '$lib/ride/keys';

/**
 * The Controllers page's test pad (#4236): which line of the key table a
 * press runs, from a key (a keyboard, a clicker, a controller bridged as
 * keys) or a paired OpenBikeControl controller. Null: WattRoom reads none.
 */
const RIDE_KEY: Record<RideKey['kind'], string> = {
	camera: 'Camera',
	clean: 'Clean view',
	map: 'Map page, and back',
	view: '3D or Flat',
	snap: 'Snapshot',
	sheet: 'The keys',
};

export function pressOfKey(
	event: Pick<
		KeyboardEvent,
		'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
	>,
): string | null {
	const shift = shiftOf(event);
	if (shift) return shift > 0 ? 'Harder' : 'Easier';
	if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
		return 'Computer page';
	if (event.key.toLowerCase() === 's' && !event.shiftKey) return 'Say the ride';
	const ride = rideKeyOf(event);
	return ride ? RIDE_KEY[ride.kind] : null;
}

const OBC: Record<ObcAction, string> = {
	harder: 'Harder',
	easier: 'Easier',
	'page-next': 'Computer page',
	'page-prev': 'Computer page',
	camera: 'Camera',
	clean: 'Clean view',
	map: 'Map page, and back',
	snap: 'Snapshot',
	talk: 'Talk',
};

export const pressOfController = (action: ObcAction): string => OBC[action];
