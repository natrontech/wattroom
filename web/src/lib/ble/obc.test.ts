import { describe, expect, it } from 'vitest';
import {
	OBC_BUTTONS,
	WATTROOM_APP_INFO,
	createObcButtons,
	decodeObc,
	encodeAppInfo,
	encodeHaptic,
	type ObcAction,
	type ObcEdge,
} from './obc';

// Every fixture below is a byte string printed in OpenBikeControl's BLE.md,
// PROTOCOL.md or MDNS.md (protocol v1).
const msg = (...bytes: number[]) => decodeObc(Uint8Array.of(...bytes));

describe('OpenBikeControl messages (#3335)', () => {
	it.each([
		['one press', [0x01, 0x01, 0x01], [{ id: 0x01, state: 0x01 }]],
		[
			'a press and a release',
			[0x01, 0x01, 0x01, 0x02, 0x00],
			[
				{ id: 0x01, state: 0x01 },
				{ id: 0x02, state: 0x00 },
			],
		],
		['an analog input', [0x01, 0x10, 0x80], [{ id: 0x10, state: 0x80 }]],
		[
			'one button, three actions',
			[0x01, 0x01, 0x01, 0x30, 0x01, 0x14, 0x01],
			[
				{ id: 0x01, state: 0x01 },
				{ id: 0x30, state: 0x01 },
				{ id: 0x14, state: 0x01 },
			],
		],
	])('decodes Button State: %s', (_, bytes, buttons) => {
		expect(msg(...bytes)).toEqual({ type: 'buttons', buttons });
	});

	it('decodes Device Status, with no battery as null', () => {
		expect(msg(0x02, 0x55, 0x01)).toEqual({
			type: 'status',
			battery: 85,
			connected: true,
		});
		expect(msg(0x02, 0xff, 0x01)).toEqual({
			type: 'status',
			battery: null,
			connected: true,
		});
	});

	it('drops a frame cut short or of another type', () => {
		expect(msg(0x01)).toBeNull();
		expect(msg(0x01, 0x01)).toBeNull();
		expect(msg(0x01, 0x01, 0x01, 0x02)).toBeNull();
		expect(msg(0x02, 0x55)).toBeNull();
		expect(msg(0x03, 0x01, 0x00, 0x00)).toBeNull();
		expect(msg()).toBeNull();
	});

	it('encodes App Information as the spec prints it', () => {
		const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
		expect([
			...encodeAppInfo('zwift', '1.52.0', [0x01, 0x02, 0x10, 0x14]),
		]).toEqual([
			0x04,
			0x01,
			0x05,
			...text('zwift'),
			0x06,
			...text('1.52.0'),
			0x04,
			0x01,
			0x02,
			0x10,
			0x14,
		]);
	});

	it('tells a controller exactly the buttons WattRoom answers, and never Gear Set', () => {
		const ids = Object.keys(OBC_BUTTONS).map(Number);
		expect(WATTROOM_APP_INFO.slice(0, 11)).toEqual(
			Uint8Array.of(0x04, 0x01, 0x08, ...new TextEncoder().encode('wattroom')),
		);
		expect(WATTROOM_APP_INFO[11]).toBe(0x00);
		expect(WATTROOM_APP_INFO[12]).toBe(ids.length);
		expect([...WATTROOM_APP_INFO.slice(13)]).toEqual(ids);
		expect(ids).not.toContain(0x03);
	});

	it('maps Shift Up and Increase Difficulty to Harder, their downs to Easier', () => {
		expect([0x01, 0x30].map((id) => OBC_BUTTONS[id])).toEqual([
			'harder',
			'harder',
		]);
		expect([0x02, 0x31].map((id) => OBC_BUTTONS[id])).toEqual([
			'easier',
			'easier',
		]);
	});

	it('encodes haptics: one short buzz a shift, the warning at an end', () => {
		expect(encodeHaptic('shift')).toEqual(
			Uint8Array.of(0x03, 0x01, 0x00, 0x00),
		);
		expect(encodeHaptic('end')).toEqual(Uint8Array.of(0x03, 0x06, 0x00, 0x00));
	});
});

describe('OBC buttons into action edges', () => {
	function edges() {
		const seen: [ObcAction, ObcEdge][] = [];
		const buttons = createObcButtons((action, edge) =>
			seen.push([action, edge]),
		);
		return { seen, take: (...b: number[]) => buttons.take(msg(...b)), buttons };
	}

	it('makes one press of a button that sends Shift Up and Increase Difficulty', () => {
		const { seen, take } = edges();
		take(0x01, 0x01, 0x01, 0x30, 0x01, 0x14, 0x01);
		take(0x01, 0x01, 0x00, 0x30, 0x00, 0x14, 0x00);
		expect(seen).toEqual([
			['harder', 'down'],
			['harder', 'up'],
		]);
	});

	it('holds an action until the last of its ids is up', () => {
		const { seen, take } = edges();
		take(0x01, 0x02, 0x01);
		take(0x01, 0x31, 0x01);
		take(0x01, 0x02, 0x00);
		expect(seen).toEqual([['easier', 'down']]);
		take(0x01, 0x31, 0x00);
		expect(seen).toEqual([
			['easier', 'down'],
			['easier', 'up'],
		]);
	});

	it('ignores buttons it does not answer, Gear Set and device status', () => {
		const { seen, take } = edges();
		take(0x01, 0x03, 0x05, 0x14, 0x01, 0x1b, 0x94);
		take(0x02, 0x55, 0x01);
		expect(seen).toEqual([]);
	});

	it('lets go of every held action when the link drops, once', () => {
		const { seen, take, buttons } = edges();
		take(0x01, 0x01, 0x01, 0x21, 0x01, 0x40, 0x01);
		take(0x01, 0x40, 0x00);
		seen.length = 0;
		buttons.drop();
		buttons.drop();
		expect(seen).toEqual([
			['harder', 'drop'],
			['talk', 'drop'],
		]);
	});
});
