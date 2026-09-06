import { describe, expect, it, vi } from 'vitest';
import type { MenuEntry, MenuItem, MenuSlider } from '$lib/context-menu.svelte';
import { youMenu } from '$lib/nav/you-menu';
import { mixer } from '$lib/sound/mixer.svelte';

// The room decides whether a voice can dip anything (#904).
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
	it('offers your page and your settings, and no page before you are loaded', () => {
		const go = vi.fn();
		const [page, settings] = youMenu('u1', go).filter(isItem);
		expect([page.label, settings.label]).toEqual([
			'Your rider page',
			'Settings',
		]);
		page.onSelect();
		settings.onSelect();
		expect(go.mock.calls).toEqual([['/u/u1'], ['/profile']]);
		expect(youMenu(undefined, go).filter(isItem)[0].disabled).toBe(true);
	});

	it('is the cue level in percent, and plays a cue at the level it lands on', () => {
		mixer.setCues(0.4);
		const [fader] = youMenu('u1', () => {}).filter(isSlider);
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
			youMenu('u1', () => {})
				.filter(isSlider)
				.map((fader) => fader.label),
		).toEqual(['Cue sounds']);
	});

	it('is the depth, off at the top, and never disagrees with the panel', () => {
		room.current = { av: {} };
		mixer.setDuck(0.7);
		const duck = youMenu('u1', () => {}).filter(isSlider)[1];
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
