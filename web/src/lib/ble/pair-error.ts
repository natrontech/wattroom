/**
 * What a rider is told when pairing a trainer or a sensor fails.
 *
 * Web Bluetooth's own errors are mostly the useful ones — a GATT failure says
 * what the radio did. `NotFoundError` is the exception: Chromium words it "User
 * cancelled the requestDevice() chooser", which is a sentence about the rider,
 * and in the desktop shell nobody cancelled anything — the chooser closed on a
 * scan that heard nothing (#1545). Say what to do about it instead.
 */
export function pairError(cause: unknown): string {
	if (cause instanceof DOMException && cause.name === 'NotFoundError')
		return 'No device picked. Wake the sensor — spin the cranks or press its button — and try again.';
	if (cause instanceof Error) return cause.message;
	return 'Could not connect to that sensor.';
}
