/**
 * The lounge's shared lamp, weather, stove, mood and radio as the client
 * reads them (ADR-0094).
 */
import type { LoungeState } from '$lib/protocol';
import type { Sky } from '$lib/lounge/palette';
import { nextRecordAt } from '$lib/lounge/records';
import { SLOT_SEC, type Style } from '$lib/lounge/station';

/** The hub's LoungeWeathers, read side by side in protocol/lounge_test.go. */
export const WEATHERS = ['rain', 'clear', 'snow'] as const;
export type Weather = (typeof WEATHERS)[number];

/** What the window shows; a tick with no lounge is the scene as it opens. */
export function weatherOf(state: LoungeState | undefined): Weather {
	const w = state?.weather;
	return WEATHERS.find((known) => known === w) ?? 'rain';
}

export function nextWeather(now: Weather): Weather {
	return WEATHERS[(WEATHERS.indexOf(now) + 1) % WEATHERS.length];
}

/**
 * The hub's LoungeRadioStyles, and '' for records, the real tracks
 * (records.ts). 'mix' rotates the generated styles.
 */
export const RADIO_PICKS = ['', 'mix', 'lofi', 'chip', 'ambient'] as const;
export type RadioPick = (typeof RADIO_PICKS)[number];

/** The style the channel picked; a word this build does not know plays records. */
export function radioPickOf(state: LoungeState | undefined): RadioPick {
	return RADIO_PICKS.find((known) => known === state?.radioStyle) ?? '';
}

/** What the generated station plays for a pick: its style, or '' for the mix. */
export function stationPick(pick: RadioPick): Style | '' {
	return pick === '' || pick === 'mix' ? '' : pick;
}

/** How long a skip waits for the next start: time for the tick to reach every screen. */
const SKIP_LEAD_MS = 1000;

/**
 * House radio's Next: the shift that starts the next record, or the next
 * tune of `pick`, a second from now on every screen. Always more than
 * `shiftMs`, as the hub requires.
 */
export function skipShift(
	station: string,
	pick: RadioPick,
	shiftMs: number,
	nowMs: number,
): number {
	const at = (nowMs + shiftMs + SKIP_LEAD_MS) / 1000;
	const next =
		pick === ''
			? nextRecordAt(station, at)
			: (Math.floor(at / SLOT_SEC) + 1) * SLOT_SEC;
	return Math.round(next * 1000 - SKIP_LEAD_MS - nowMs);
}

/**
 * The hub's LoungeMoods and what each sets for everyone in one tap: the
 * window, the lamp, the stove, the radio, and the sky the window shows.
 */
export const MOODS = {
	rainy: {
		name: 'Rainy night',
		weather: 'rain',
		lampOff: false,
		fire: true,
		radio: '',
		sky: 'night',
	},
	snow: {
		name: 'Snow day',
		weather: 'snow',
		lampOff: false,
		fire: true,
		radio: 'ambient',
		sky: 'day',
	},
	sunny: {
		name: 'Sunny afternoon',
		weather: 'clear',
		lampOff: true,
		fire: false,
		radio: 'lofi',
		sky: 'day',
	},
	arcade: {
		name: 'Arcade',
		weather: 'clear',
		lampOff: true,
		fire: false,
		radio: 'chip',
		sky: 'night',
	},
} as const satisfies Record<
	string,
	{
		name: string;
		weather: Weather;
		lampOff: boolean;
		fire: boolean;
		radio: RadioPick;
		sky: Sky;
	}
>;
export type Mood = keyof typeof MOODS;

/** The mood the channel picked; one this build does not know is none. */
export function moodOf(state: LoungeState | undefined): Mood | '' {
	const m = state?.mood;
	return m && m in MOODS ? (m as Mood) : '';
}
