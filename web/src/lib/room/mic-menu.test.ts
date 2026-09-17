import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItem } from '$lib/context-menu.svelte';
import { micMenu } from '$lib/room/mic-menu';
import { soundPanel } from '$lib/room/sound-panel.svelte';

// Opening the panel asks the browser for devices on the way in (#658).
vi.mock('$lib/room/connection.svelte', () => ({
	roomConnection: { current: { av: { refreshDevices: () => {} } } },
}));

// A phone is the pointer, not the width (#2142) — the one thing the gate
// entries below branch on.
const env = vi.hoisted(() => ({ coarse: false }));
vi.mock('$lib/device.svelte', () => ({
	device: env,
	deviceWord: () => (env.coarse ? 'phone' : 'desktop'),
}));

const items = (entries: ReturnType<typeof micMenu>): MenuItem[] =>
	entries.filter((entry): entry is MenuItem => entry !== 'separator');

const voice = (over: Partial<Parameters<typeof micMenu>[0]> = {}) => ({
	micOn: true,
	mode: 'gate' as const,
	setMode: vi.fn(),
	mics: [
		{ deviceId: 'built-in', label: 'MacBook Pro Microphone' },
		{ deviceId: 'usb', label: '' },
	],
	micId: 'built-in',
	setMic: vi.fn(),
	...over,
});

describe('micMenu (#914)', () => {
	beforeEach(() => {
		soundPanel.open = false;
		env.coarse = false;
	});

	it('says what the click already does, either way round', () => {
		const onMic = vi.fn();
		const [mute] = items(micMenu(voice(), onMic));
		expect(mute.label).toBe('Mute');
		mute.onSelect();
		expect(onMic).toHaveBeenCalledOnce();
		expect(items(micMenu(voice({ micOn: false }), onMic))[0].label).toBe(
			'Unmute',
		);
	});

	it('marks the mode you are in rather than greying it out', () => {
		const gate = items(micMenu(voice(), () => {}));
		expect(gate.map((item) => [item.label, item.hint])).toEqual([
			['Mute', undefined],
			['Voice activation', 'on'],
			// The key is the instruction (#1879).
			['Push to talk', 'hold Space'],
			['System default', undefined],
			['MacBook Pro Microphone', 'on'],
			['Microphone 2', undefined],
			['Tune your gate…', undefined],
		]);
		expect(gate.every((item) => !item.disabled)).toBe(true);
		const ptt = items(micMenu(voice({ mode: 'ptt' }), () => {}));
		expect(ptt.map((item) => item.hint)).toEqual([
			undefined,
			undefined,
			'on',
			undefined,
			'on',
			undefined,
			undefined,
		]);
	});

	// An unnamed device is numbered, not blank, and the browser's own choice
	// leads the list — `deviceOptions`, so the panel says the same words.
	it('switches which microphone you speak through', () => {
		const setMic = vi.fn();
		const list = items(micMenu(voice({ setMic }), () => {}));
		list.find((item) => item.label === 'Microphone 2')?.onSelect();
		list.find((item) => item.label === 'System default')?.onSelect();
		expect(setMic.mock.calls).toEqual([['usb'], ['']]);
	});

	it('switches how you transmit without opening anything', () => {
		const setMode = vi.fn();
		const [, gate, ptt] = items(micMenu(voice({ setMode }), () => {}));
		gate.onSelect();
		ptt.onSelect();
		expect(setMode.mock.calls).toEqual([['gate'], ['ptt']]);
		expect(soundPanel.open).toBe(false);
	});

	// The threshold is its meter (#289), so the menu hands you the surface
	// that has one instead of a number you cannot aim.
	it('offers the way to the meter for the threshold itself', () => {
		const tune = items(micMenu(voice(), () => {})).at(-1)!;
		expect(tune.label).toBe('Tune your gate…');
		tune.onSelect();
		expect(soundPanel.open).toBe(true);
	});

	// #2142: a handheld runs no gate — the mic button is it (docs/SPEC.md).
	// The silent one: the entries still rendered, "Voice activation" was
	// marked `on` while nothing gated anything, and "Tune your gate…" opened
	// a panel that says there is no gate to tune.
	it('offers no gate on a handheld, because there is none', () => {
		env.coarse = true;
		const list = items(micMenu(voice(), () => {}));
		expect(list.map((item) => item.label)).toEqual([
			'Mute',
			'System default',
			'MacBook Pro Microphone',
			'Microphone 2',
			// The panel is still where the mix and the microphone live.
			'Sound…',
		]);
		list.at(-1)!.onSelect();
		expect(soundPanel.open).toBe(true);
	});
});
