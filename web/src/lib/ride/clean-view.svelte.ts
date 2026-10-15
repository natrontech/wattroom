/**
 * Clean view (#3215, #3216): the 3 s power, the road line and the Skyline
 * only. H toggles it; the choice is remembered per device.
 */
const KEY = 'wattroom.ride.clean.v1';

function read(): boolean {
	try {
		return localStorage.getItem(KEY) === '1';
	} catch {
		return false;
	}
}

let on = $state(read());

export const cleanView = {
	get on() {
		return on;
	},
	toggle() {
		on = !on;
		try {
			localStorage.setItem(KEY, on ? '1' : '0');
		} catch {
			/* a browser that keeps nothing keeps the ride's own */
		}
	},
};
