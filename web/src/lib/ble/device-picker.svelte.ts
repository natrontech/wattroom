/**
 * The desktop shell's Bluetooth device picker, seen from the app (#1716).
 *
 * Electron ships no chooser (RESEARCH.md §15.1), so the shell used to answer
 * `select-bluetooth-device` with a native message box — one button per device,
 * capped at eight, drawn by the OS in the middle of a synthwave app. It was
 * also a snapshot: it opened on the first device heard, so a second sensor
 * that advertised a moment later was invisible until the rider cancelled and
 * started again.
 *
 * Now the shell streams the scan here and this draws it. `devices` is null
 * whenever no request is open, `[]` while the radio is still listening, and
 * grows as the scan finds things.
 *
 * In a browser there is no shell and Chrome draws its own chooser, so nothing
 * below ever runs — `start()` is a no-op and the host renders nothing.
 */
export interface BleDevice {
	id: string;
	name: string;
}

interface Shell {
	onBleScan?: (cb: (devices: BleDevice[] | null) => void) => void;
	pickDevice?: (deviceId: string | null) => void;
}

function shell(): Shell | undefined {
	return (globalThis as { wattroom?: Shell }).wattroom;
}

let devices = $state.raw<BleDevice[] | null>(null);
let started = false;

export const devicePicker = {
	/** The scan's devices, or null when no request is open. */
	get devices() {
		return devices;
	},
	/**
	 * Subscribe to the shell's scans. Idempotent, and silent in a browser —
	 * the layout calls it once on mount.
	 */
	start() {
		if (started) return;
		const bridge = shell();
		if (!bridge?.onBleScan) return;
		started = true;
		bridge.onBleScan((next) => (devices = next));
	},
	/**
	 * Answer the open request. The shell closes the picker on its own once it
	 * has the answer, so this does not clear `devices` — doing both would race
	 * a scan that has already moved on.
	 */
	pick(deviceId: string | null) {
		shell()?.pickDevice?.(deviceId);
	},
};
