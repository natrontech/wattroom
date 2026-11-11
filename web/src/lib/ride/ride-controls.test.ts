import { describe, expect, it } from 'vitest';
import type { PauseState, ViewState } from '$lib/protocol';
import { clockActions, LAST_BLOCK, NO_BLOCKS } from './remote-blocks';
import {
	answerLine,
	CONTROLS,
	NEEDS_3D,
	NOT_ON_SCREEN,
	PHOTOS_FULL,
	phoneTiles,
	phoneViews,
	remoteLine,
} from './ride-controls';
import { OFFERED } from './ride-offers.svelte';

const view = (v: Partial<ViewState> = {}): ViewState => ({
	look: '3d',
	world: true,
	offers: ['view-3d', 'view-flat', 'flag', 'tv'],
	...v,
});
const solo: PauseState = { pausable: true, paused: false, blocks: true };
const tiles = (v: ViewState | null, pause: PauseState | null, social = false) =>
	phoneTiles({ view: v, pause, social });
const names = (v: ViewState | null, pause: PauseState | null, social = false) =>
	tiles(v, pause, social).tiles.map((t) => t.control);
const held = (v: ViewState | null, pause: PauseState | null) =>
	tiles(v, pause)
		.tiles.filter((t) => t.disabled)
		.map((t) => t.control);

describe('the ride’s controls, one list for the bar and the phone', () => {
	it('sends only what the riding screen runs', () => {
		// Every control the phone draws is an action a riding screen handles:
		// its own controls' offers, the clock's, the world's and Cheer.
		const handled = new Set<string>([
			...OFFERED,
			...Object.keys(clockActions(() => null)),
			'camera',
			'photo',
			'cheer-back',
		]);
		for (const control of Object.keys(CONTROLS))
			expect(handled, control).toContain(control);
	});

	it('gives a workout alone the bar’s whole row, in the bar’s order', () => {
		expect(names(view({ offers: [...view().offers!, 'end'] }), solo)).toEqual([
			'camera',
			'photo',
			'tv',
			'flag',
			'pause',
			'extend',
			'skip',
			'end',
		]);
	});

	it('leaves a session’s clock to its coach, and adds Cheer in a call', () => {
		expect(names(view(), { pausable: false, paused: false }, true)).toEqual([
			'camera',
			'photo',
			'tv',
			'flag',
			'cheer-back',
		]);
	});

	it('turns Pause into Resume while paused, pressed', () => {
		const t = tiles(view(), { ...solo, paused: true }).tiles;
		expect(t.find((x) => x.control === 'resume')).toMatchObject({
			disabled: false,
			pressed: true,
		});
		expect(t.some((x) => x.control === 'pause')).toBe(false);
	});

	it.each<
		[string, ViewState | null, PauseState | null, string[], string | null]
	>([
		['all live', view(), solo, [], null],
		[
			'flat holds Camera and Photo',
			view({ world: false, look: 'flat' }),
			solo,
			['camera', 'photo'],
			NEEDS_3D,
		],
		[
			'no blocks by the clock',
			view(),
			{ ...solo, blocks: false },
			['extend', 'skip'],
			NO_BLOCKS,
		],
		[
			'the last block holds Skip',
			view(),
			{ ...solo, last: true },
			['skip'],
			LAST_BLOCK,
		],
		[
			'the ride’s photos at their cap hold Photo (#4495)',
			view({ pictures: 5 }),
			solo,
			['photo'],
			PHOTOS_FULL,
		],
		[
			'a screen with no TV or ⚑',
			view({ offers: [] }),
			null,
			['tv', 'flag'],
			NOT_ON_SCREEN,
		],
		[
			'before the screen answers',
			null,
			null,
			['camera', 'photo', 'tv', 'flag'],
			null,
		],
	])('%s', (_, v, pause, want, hint) => {
		expect(held(v, pause)).toEqual(want);
		expect(tiles(v, pause).hint).toBe(hint);
	});

	it('draws no Camera or Photo off a road, as the bar draws none', () => {
		const offRoad = view({
			look: 'flat',
			world: false,
			offers: ['tv', 'flag'],
		});
		expect(names(offRoad, null)).toEqual(['tv', 'flag']);
		expect(tiles(offRoad, null).hint).toBeNull();
	});

	it('says TV is up on the riding screen', () => {
		expect(
			tiles(view({ tv: true }), null).tiles.find((t) => t.control === 'tv'),
		).toMatchObject({ pressed: true, disabled: false });
	});
});

describe('the phone’s view row is the riding screen’s view switch', () => {
	it('draws the segments the switch offers, pressed where it looks', () => {
		expect(
			phoneViews(
				view({ look: 'map', offers: ['view-flat', 'view-map', 'view-room'] }),
			),
		).toEqual([
			{ segment: 'flat', pressed: false },
			{ segment: 'map', pressed: true },
			{ segment: 'room', pressed: false },
		]);
		expect(phoneViews(null)).toEqual([]);
	});
});

describe('the phone remote’s line (#4253)', () => {
	const none = { pictures: null, flags: null };
	it.each([
		['no answer yet', null, false, none, null],
		['flat', view({ look: 'flat', world: false }), false, none, 'Flat'],
		[
			'3D with its camera',
			view({ camera: 'heli' }),
			false,
			none,
			'3D · Overhead',
		],
		[
			'a camera off 3D is not said',
			view({ look: 'flat', world: false, camera: 'side' }),
			false,
			none,
			'Flat',
		],
		[
			'paused, on the map, TV up',
			view({ look: 'map', tv: true }),
			true,
			none,
			'Paused · Map · TV',
		],
		[
			'Photo pressed, not taken yet',
			view({ pictures: 1, camera: 'chase' }),
			false,
			{ pictures: 1, flags: null },
			'3D · Chase',
		],
		[
			'Photo taken',
			view({ pictures: 2 }),
			false,
			{ pictures: 1, flags: null },
			"Photo 2 of 5 · on the ride's page after",
		],
		[
			'the first picture of the ride',
			view({ pictures: 1 }),
			false,
			{ pictures: 0, flags: null },
			"Photo 1 of 5 · on the ride's page after",
		],
		[
			'Flag taken',
			view({ flags: 1 }),
			false,
			{ pictures: null, flags: 0 },
			'Flagged',
		],
	] as const)('%s', (_, v, paused, since, want) => {
		expect(remoteLine(v, paused, since)).toBe(want);
	});
});

describe('the answer on the phone’s Easier / Harder (#3334)', () => {
	it.each([
		['a blind gear is named', '0', false, 'Gear 0'],
		['a blind gear up', '+2', false, 'Gear +2'],
		['a blind gear down', '−3', false, 'Gear −3'],
		['a table gear at its end', 'Gear 24', true, 'Gear 24 · end'],
		['the bias says what it is', 'Bias 103%', false, 'Bias 103%'],
		['the watts at their end', '1000 W', true, '1000 W · end'],
	])('%s', (_, label, atEnd, want) => {
		expect(answerLine({ label, atEnd })).toBe(want);
	});
});
