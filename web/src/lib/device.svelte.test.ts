import { describe, expect, it } from 'vitest';
import { isSpectator, PHONE_MAX_PX, type DeviceEnv } from './device.svelte';

const env = (over: Partial<DeviceEnv> = {}): DeviceEnv => ({
	narrow: false,
	coarse: false,
	bluetooth: true,
	cockpit: false,
	...over,
});

describe('isSpectator', () => {
	// The locked case (WATTROOM.md): iOS Safari will never have Web Bluetooth.
	it('calls a phone a spectator', () => {
		expect(
			isSpectator(env({ narrow: true, coarse: true, bluetooth: false })),
		).toBe(true);
	});

	// ADR-0020: "a narrow window and a phone are different questions". Dragging
	// a desktop window under 768px used to throw the rider out of the room.
	it('leaves a narrow desktop window the cockpit', () => {
		expect(isSpectator(env({ narrow: true, coarse: false }))).toBe(false);
	});

	// Chrome on Android pairs a trainer. Hiding the button there would be a
	// lie about the device, which is the opposite of ux.md's gating rule.
	it('leaves a phone that can reach a trainer the cockpit', () => {
		expect(
			isSpectator(env({ narrow: true, coarse: true, bluetooth: true })),
		).toBe(false);
	});

	it('leaves a tablet-width touch screen the cockpit', () => {
		expect(isSpectator(env({ coarse: true, bluetooth: false }))).toBe(false);
	});

	// ?full=1 kept its meaning when the watch page stopped being a dead end:
	// give this device the cockpit anyway.
	it('lets ?full=1 override every signal', () => {
		expect(
			isSpectator(
				env({ narrow: true, coarse: true, bluetooth: false, cockpit: true }),
			),
		).toBe(false);
	});

	it('is the md boundary the sidebar becomes a drawer at', () => {
		expect(PHONE_MAX_PX).toBe(767);
	});
});
