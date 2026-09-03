import { device } from '$lib/device.svelte';
import type { SensorClaim } from '$lib/protocol';
import { tabId } from '$lib/room/rejoin';
import { SENSOR_KINDS, sensors } from '$lib/sensors.svelte';

/**
 * What this tab tells the hub it has connected (#610).
 *
 * The claim is the whole set every time, never a delta: a message lost to a
 * reconnect then cannot leave a sensor claimed by a tab that no longer holds
 * it. Order is fixed so an unchanged set compares equal and sends nothing.
 */
export function sensorClaim(hasTrainer: boolean): SensorClaim {
	const held: string[] = [];
	if (hasTrainer) held.push('trainer');
	for (const kind of SENSOR_KINDS) {
		if (sensors.slot(kind).status === 'connected') held.push(kind);
	}
	// `tabId()` answers the literal 'no-storage' when sessionStorage is blocked
	// — the same string in every tab of that browser. Sent as-is, two tabs
	// would both match the claim's owner and both pass the hub's metrics gate,
	// putting the double-stream bug back exactly where storage is blocked
	// (a private window). Sending nothing is the honest answer: the hub falls
	// back to identifying the socket, which arbitrates correctly and only
	// gives up surviving a reload.
	const tab = tabId();
	return {
		held,
		tab: tab === 'no-storage' ? '' : tab,
		device: deviceWord(),
	};
}

/**
 * The word another of the rider's screens renders for this one — "paired on
 * your phone". Coarse on purpose: it is a hint about where to go looking, and
 * anything narrower would be a device fingerprint for no benefit.
 *
 * It never leaves the rider's own sockets (the hub addresses SensorPairing to
 * them alone), so this is not a room-visible label.
 */
export function deviceWord(): string {
	if (!device.coarse) return 'desktop';
	return device.narrow ? 'phone' : 'tablet';
}
