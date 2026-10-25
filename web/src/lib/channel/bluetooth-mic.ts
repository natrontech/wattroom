/**
 * The mic that keeps Bluetooth headphones in music quality (#4161, SPEC voice
 * channel audio). While anything captures a Bluetooth headset's own mic, the
 * headset drops from its music profile (A2DP) to its call profile (HFP), and
 * everything it plays goes mono and narrow: the jukebox, YouTube and the crew's
 * voices alike. The computer's own mic leaves the headset alone.
 *
 * Browsers do not say "Bluetooth" as a fact. What they expose is a label and a
 * `groupId`, and Chromium on macOS and Windows ends a label with how the device
 * is attached: "AirPods Pro (Bluetooth)", "MacBook Pro Microphone (Built-in)",
 * "Hue Sync Audio (Virtual)". A mic and an output sharing a groupId are one
 * device, but that alone is no headset: a MacBook's own mic and speakers share
 * one too.
 */

/** The fields of a MediaDeviceInfo this reads. */
export interface DeviceSeen {
	kind: string;
	deviceId: string;
	label: string;
	groupId: string;
}

/**
 * Chromium's "(Bluetooth)" and "(Bluetooth LE)", Windows' hands-free endpoint,
 * and the one headset Firefox and Safari name without a transport.
 */
const BLUETOOTH = /bluetooth|hands-free|airpods/i;
/**
 * The computer's own: Chromium's "(Built-in)", the names Safari and Firefox
 * give a Mac's, a laptop's array on Windows, PipeWire's "Built-in Audio".
 */
const OWN = /built-?in|macbook|imac|microphone array|internal/i;
const VIRTUAL = /virtual/i;
/** Chrome's stand-ins for whatever the system currently routes to. */
const STAND_INS = new Set(['', 'default', 'communications']);

/**
 * What the rider hears through: the system default, where the jukebox and
 * YouTube play (Chrome lists it first as "default", Firefox and Safari first
 * as itself), and the output picked for voices, if one was.
 */
function outputsInUse(list: DeviceSeen[], outId: string): DeviceSeen[] {
	const outs = list.filter((d) => d.kind === 'audiooutput');
	const system = outs.find((d) => d.deviceId === 'default') ?? outs[0];
	const voices = outId ? outs.find((d) => d.deviceId === outId) : undefined;
	return [system, voices].filter((d): d is DeviceSeen => !!d);
}

/**
 * The computer's own mic when the mic the browser would open is a Bluetooth
 * headset's that is also playing what the rider hears, or null to leave the
 * browser's choice alone. Null too when nothing names the computer's own: a
 * guessed mic that hears nothing is worse than call-quality music.
 */
export function micBesideBluetooth(
	list: DeviceSeen[],
	outId = '',
): DeviceSeen | null {
	const mics = list.filter((d) => d.kind === 'audioinput');
	const opens = mics.find((d) => d.deviceId === 'default') ?? mics[0];
	if (!opens) return null;
	const outs = outputsInUse(list, outId);
	// Without a listed output (Safari before 18.4), the headset's own mic is
	// the only evidence of where the sound goes.
	const headset = outs.length
		? outs.some(
				(out) =>
					BLUETOOTH.test(out.label) &&
					((!!out.groupId && out.groupId === opens.groupId) ||
						BLUETOOTH.test(opens.label)),
			)
		: BLUETOOTH.test(opens.label);
	if (!headset) return null;
	return (
		mics.find(
			(d) =>
				!STAND_INS.has(d.deviceId) &&
				d.groupId !== opens.groupId &&
				OWN.test(d.label) &&
				!BLUETOOTH.test(d.label) &&
				!VIRTUAL.test(d.label),
		) ?? null
	);
}
