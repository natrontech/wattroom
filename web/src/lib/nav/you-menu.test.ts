import { describe, expect, it, vi } from 'vitest';
import type { MenuEntry, MenuItem, MenuSlider } from '$lib/context-menu.svelte';
import { youMenu } from '$lib/nav/you-menu';
import { mixer } from '$lib/sound/mixer.svelte';

// The room decides whether a voice can dip anything (#904), and whether this
// browser can move the voice to another output (#920).
const room = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('$lib/room/connection.svelte', () => ({ roomConnection: room }));

// The cue engine is an AudioContext; the fader only has to reach it.
const cues = vi.hoisted(() => ({ played: [] as string[] }));
vi.mock('$lib/sound/cues', () => ({
	play: (id: string) => void cues.played.push(id),
	setVolume: () => {},
	setDuckLevel: () => {},
}));

const isItem = (entry: MenuEntry): entry is MenuItem =>
	entry !== 'separator' && entry.kind !== 'slider';
const isSlider = (entry: MenuEntry): entry is MenuSlider =>
	entry !== 'separator' && entry.kind === 'slider';

describe('youMenu (#898)', () => {
	it('offers your page and your settings, at their own addresses', () => {
		const go = vi.fn();
		const [page, settings] = youMenu(go).filter(isItem);
		expect([page.label, settings.label]).toEqual([
			'Your rider page',
			'Settings',
		]);
		page.onSelect();
		settings.onSelect();
		expect(go.mock.calls).toEqual([['/u/me'], ['/settings']]);
		expect(page.disabled).toBeUndefined();
	});

	it('is the cue level in percent, and plays a cue at the level it lands on', () => {
		mixer.setCues(0.4);
		const [fader] = youMenu(() => {}).filter(isSlider);
		expect([fader.value, fader.format(fader.value), fader.max]).toEqual([
			40,
			'40%',
			100,
		]);
		fader.onInput(65);
		expect(mixer.cues).toBeCloseTo(0.65);
		// Nothing sounds while the thumb moves; the release demonstrates it.
		expect(cues.played).toEqual([]);
		fader.onChange?.(65);
		expect(cues.played).toEqual(['block']);
		mixer.setCues(0.7);
	});
});

// The dip belongs to the same mix, and reads the way the Sound panel's fader
// reads: right is off (#904).
describe('youMenu duck', () => {
	it('offers no dip outside a room — there is no voice to dip under', () => {
		room.current = null;
		expect(
			youMenu(() => {})
				.filter(isSlider)
				.map((fader) => fader.label),
		).toEqual(['Cue sounds']);
	});

	it('is the depth, off at the top, and never disagrees with the panel', () => {
		room.current = { av: {} };
		mixer.setDuck(0.7);
		const duck = youMenu(() => {}).filter(isSlider)[1];
		expect([duck.label, duck.value, duck.format(duck.value)]).toEqual([
			'Duck under voice',
			70,
			'\u221230%',
		]);
		expect(duck.format(100)).toBe('off');
		duck.onInput(25);
		expect(mixer.duck).toBeCloseTo(0.25);
		mixer.setDuck(0.75);
		room.current = null;
	});
});

// Your ears, where the cue level already is (#920).
describe('youMenu speakers', () => {
	const av = (over: Record<string, unknown> = {}) => ({
		av: {
			canPickOutput: true,
			outs: [{ deviceId: 'hdmi', label: 'LG Display' }],
			outId: '',
			setOut: vi.fn(),
			...over,
		},
	});
	const labels = () =>
		youMenu(() => {}).map((e) => e !== 'separator' && e.label);

	it('offers no output list where the browser cannot switch sinks', () => {
		room.current = av({ canPickOutput: false });
		expect(labels()).not.toContain('LG Display');
		room.current = av({ outs: [] });
		expect(labels()).not.toContain('System default');
	});

	it('marks where the voice comes out, and moves it', () => {
		const setOut = vi.fn();
		room.current = av({ setOut });
		const entries = youMenu(() => {}).filter(
			(entry): entry is MenuItem =>
				entry !== 'separator' && entry.kind !== 'slider',
		);
		expect(entries.map((item) => [item.label, item.hint]).slice(-2)).toEqual([
			['System default', 'on'],
			['LG Display', undefined],
		]);
		entries.at(-1)!.onSelect();
		expect(setOut).toHaveBeenCalledWith('hdmi');
		room.current = null;
	});
});
