/** A device list as `Select` options, for every surface that picks devices. */
export interface Device {
	deviceId: string;
	label: string;
}

/**
 * One list of device options (#477): both the room's Sound panel and
 * /profile's Voice & audio page render them, and a second copy is how the
 * two drift on what an unnamed device is called.
 *
 * The empty value is "System default" — the browser's own choice, which is
 * also what a device that vanished falls back to. Devices arrive unnamed
 * until a voice join grants mic access, so an unlabelled one is numbered
 * rather than blank.
 */
export function deviceOptions(
	list: Device[],
	kind: string,
): { value: string; label: string }[] {
	return [
		{ value: '', label: 'System default' },
		...list
			.filter((d) => d.deviceId && d.deviceId !== 'default')
			.map((d, i) => ({
				value: d.deviceId,
				label: d.label || `${kind} ${i + 1}`,
			})),
	];
}
