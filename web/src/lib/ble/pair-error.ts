import type { SensorKind } from './sensor';

/**
 * A strap that was picked and then refused the link (#2650). A Garmin HRM 600
 * ships a *secure* connection type — encrypted, authenticated, for a bonded
 * Garmin watch — and advertises in it, so it shows up in the chooser and then
 * fails. Its manual recommends the *open* type for third-party apps: a double
 * press toggles it, and the LED says which (2 flashes secure, 3 open). The
 * other usual cause is an app that already holds one of the strap's links.
 */
const STRAP_HINT =
	'On a Garmin HRM 600, press its button twice quickly so its light flashes 3 times, not 2, then Retry. Otherwise close any other app using the strap.';

/**
 * What a rider is told when pairing a trainer or a sensor fails.
 *
 * Web Bluetooth's own errors are mostly the useful ones — a GATT failure says
 * what the radio did. `NotFoundError` is the exception: Chromium words it "User
 * cancelled the requestDevice() chooser", which is a sentence about the rider,
 * and in the desktop shell nobody cancelled anything — the chooser closed on a
 * scan that heard nothing (#1545). Say what to do about it instead.
 */
export function pairError(cause: unknown, kind?: SensorKind): string {
	if (cause instanceof DOMException && cause.name === 'NotFoundError')
		return 'No device picked. Wake the sensor — spin the cranks or press its button — and try again.';
	const message =
		cause instanceof Error
			? cause.message
			: 'Could not connect to that sensor.';
	if (kind !== 'heart-rate') return message;
	return `${message.replace(/[.\s]*$/, '.')} ${STRAP_HINT}`;
}
