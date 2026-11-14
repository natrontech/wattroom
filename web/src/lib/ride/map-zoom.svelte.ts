/**
 * The ride's Map on a land's loop: the loop you ride, or the whole land.
 * A tap on the map turns it; the choice is remembered per device.
 */
const KEY = 'wattroom.ride.map-zoom.v1';

function read(): boolean {
	try {
		return localStorage.getItem(KEY) !== 'whole';
	} catch {
		return true;
	}
}

let loop = $state(read());

export const mapZoom = {
	/** Zoomed to the loop being ridden. */
	get loop() {
		return loop;
	},
	toggle() {
		loop = !loop;
		try {
			localStorage.setItem(KEY, loop ? 'loop' : 'whole');
		} catch {
			/* a browser that keeps nothing keeps the ride's own */
		}
	},
};
