/**
 * Which mic, camera and speakers this rider picked (#181 feedback: "which
 * input/output/camera is this?"). '' = the browser default. Persisted per
 * device, so a chosen mic survives a rejoin.
 *
 * Split out of av.svelte.ts (#892): it touches localStorage and
 * navigator.mediaDevices and nothing else, so it is testable without
 * livekit-client anywhere near it.
 */

const DEVICES_KEY = 'wattroom.devices.v1';

export type DeviceChoices = ReturnType<typeof createDeviceChoices>;

// One store above the router (#1858), the way `soloTrainer` is for pairing:
// a mic picked on /settings/voice with no room open is the mic the next
// join captures, and the room's chain and the settings page read the same
// pick. `createDeviceChoices` stays exported for the tests.
let shared: DeviceChoices | undefined;
export function deviceChoices(): DeviceChoices {
	return (shared ??= createDeviceChoices());
}

export function createDeviceChoices() {
	let micId = $state('');
	let camId = $state('');
	let outId = $state('');
	let list = $state<MediaDeviceInfo[]>([]);

	try {
		const saved = JSON.parse(localStorage.getItem(DEVICES_KEY) ?? '{}');
		if (typeof saved.mic === 'string') micId = saved.mic;
		if (typeof saved.cam === 'string') camId = saved.cam;
		if (typeof saved.out === 'string') outId = saved.out;
	} catch {
		// per-device convenience only
	}

	function persist() {
		try {
			localStorage.setItem(
				DEVICES_KEY,
				JSON.stringify({ mic: micId, cam: camId, out: outId }),
			);
		} catch {
			// per-device convenience only
		}
	}

	// Computed on read, never $derived: a derived created here belongs to
	// whichever component happened to construct the store, and Svelte freezes
	// it at its last value once that component unmounts (derived_inert). The
	// connection outlives every page (#173), so it would freeze on the first
	// navigation away from the room.
	const mics = () => list.filter((d) => d.kind === 'audioinput');

	return {
		get micId() {
			return micId;
		},
		get camId() {
			return camId;
		},
		get outId() {
			return outId;
		},
		get mics() {
			return mics();
		},
		get cams() {
			return list.filter((d) => d.kind === 'videoinput');
		},
		get outs() {
			return list.filter((d) => d.kind === 'audiooutput');
		},
		setMic(id: string) {
			micId = id;
			persist();
		},
		setCam(id: string) {
			camId = id;
			persist();
		},
		setOut(id: string) {
			outId = id;
			persist();
		},
		async refresh() {
			try {
				list = await navigator.mediaDevices.enumerateDevices();
			} catch {
				list = [];
			}
		},
		/**
		 * A chosen mic that is no longer plugged in stops being chosen (#640),
		 * so the next open lands on the default instead of failing on an exact
		 * deviceId. Only judged against a list that NAMES its devices: before
		 * permission, enumerateDevices hands back blank ids, and a blank list
		 * must not un-choose a headset that is sitting right there. A mic
		 * another app holds, or a permission blip, must not forget the rider's
		 * pick for good either (#824) — absence from a named list is the only
		 * thing that counts as unplugged.
		 *
		 * Was written out twice before #892 — once on a failed capture, once on
		 * devicechange — which is two places for the #824 subtlety to drift.
		 */
		forgetMicIfUnplugged() {
			const known = mics();
			if (
				micId &&
				known.some((d) => d.deviceId) &&
				!known.some((d) => d.deviceId === micId)
			) {
				micId = '';
				persist();
			}
		},
	};
}
