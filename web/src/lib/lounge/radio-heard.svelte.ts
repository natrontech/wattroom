/**
 * Whether this device plays house radio when it is on the deck (ADR-0094):
 * each rider's own opt-out, kept per device like the mix. Off, the station
 * stays on the deck for everyone else.
 */
const KEY = 'wattroom.lounge.radio.v1';

function read(): boolean {
	try {
		return localStorage.getItem(KEY) !== 'off';
	} catch {
		return true;
	}
}

let heard = $state(read());

export const radioHeard = {
	get current() {
		return heard;
	},
	set(on: boolean) {
		heard = on;
		try {
			if (on) localStorage.removeItem(KEY);
			else localStorage.setItem(KEY, 'off');
		} catch {
			// Kept for this visit only.
		}
	},
};
