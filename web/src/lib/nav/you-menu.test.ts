import { describe, expect, it, vi } from 'vitest';
import type { MenuEntry, MenuItem, MenuSlider } from '$lib/context-menu.svelte';
import { youMenu } from '$lib/nav/you-menu';
import { mixer } from '$lib/sound/mixer.svelte';

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
