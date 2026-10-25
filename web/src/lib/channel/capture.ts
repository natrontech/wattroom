/**
 * What we ask the browser for when we open the mic, and which mic.
 *
 * `autoGainControl` is the load-bearing one, and it stays ON (#555). Turning
 * it off for #514 looked local — a fixed threshold cannot mean much while a
 * gain stage keeps moving what the level is — and it broke the call three ways
 * at once:
 *
 *   - every rider went quiet, and was lost under music at 10 %;
 *   - LiveKit decides who is speaking from the published track's level, and
 *     the jukebox's ducking rides on that (`JukeboxDock` reads `av.speaking`), so
 *     nothing dipped for anyone any more;
 *   - gate thresholds are persisted per device against an AGC'd signal, so a
 *     rider's own stored threshold could now sit above their voice.
 *
 * The meter dancing in silence — what turning it off was aimed at — is
 * cosmetic beside a call that cannot hear itself. The answer there is a
 * threshold that follows the noise floor, not a gain stage switched off.
 *
 * `noiseSuppression` is OFF (ADR-0043, #1340). Chrome's suppressor is a
 * spectral gate tuned for a call centre: it takes the fan and the voice's
 * air with it, and riders heard the result as "noise reduction and stuff".
 * The gate (`gate.ts`) is what keeps the fan out of the call between
 * sentences; while a rider talks, the call hears the rider, fan and all.
 *
 * `echoCancellation` stays on: it is the only thing between a rider on
 * speakers and the call hearing itself back.
 */
export const MIC_CONSTRAINTS = {
	noiseSuppression: false,
	echoCancellation: true,
	autoGainControl: true,
} as const;

/** What opening the mic asks of the device store. */
export interface MicDevices {
	/** The rider's pick, '' for none. */
	readonly micId: string;
	/** The computer's own mic, while Bluetooth headphones play (#4161). */
	readonly besideBluetooth: { deviceId: string } | null;
	/** The pick failed to open: forget it if it is no longer plugged in. */
	forgetMicIfUnplugged(): void;
	/** That mic sent pure silence: never choose it again on this page. */
	heardNothing(id: string): void;
	refresh(): Promise<void>;
}

/**
 * Opens the mic: the rider's pick, else the computer's own beside Bluetooth
 * headphones (#4161), else the browser's default. An unplugged pick falls
 * back instead of failing the join. `mic` is the input it opened, '' for the
 * default.
 */
export async function captureMic(
	devices: MicDevices,
): Promise<{ raw: MediaStream; mic: string }> {
	const exactly = (id: string) =>
		navigator.mediaDevices.getUserMedia({
			audio: { ...MIC_CONSTRAINTS, deviceId: { exact: id } },
		});
	// Capturing a Bluetooth headset's mic drops all it plays to call quality.
	// The store decides, on a fresh list.
	const besideBluetooth = async () => {
		if (devices.micId) return '';
		await devices.refresh();
		return devices.besideBluetooth?.deviceId ?? '';
	};

	const picked = devices.micId;
	if (picked) {
		try {
			return { raw: await exactly(picked), mic: picked };
		} catch {
			// The open still falls back to the default below either way; the
			// store decides whether the pick itself is forgotten (#824).
			devices.forgetMicIfUnplugged();
		}
	}
	const before = await besideBluetooth();
	if (before) {
		const raw = await exactly(before).catch(() => null);
		if (raw) return { raw, mic: before };
	}
	const raw = await navigator.mediaDevices.getUserMedia({
		audio: MIC_CONSTRAINTS,
	});
	// A first grant is what names the devices, so the list judged before it
	// could see no headset. Judged again, and moved off the headset once.
	const after = before ? '' : await besideBluetooth();
	const moved = after ? await exactly(after).catch(() => null) : null;
	if (!moved) return { raw, mic: '' };
	for (const t of raw.getTracks()) t.stop();
	return { raw: moved, mic: after };
}
