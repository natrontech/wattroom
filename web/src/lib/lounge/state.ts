/**
 * The lounge's shared lamp, weather and radio style as the client reads them
 * (ADR-0094).
 */
import type { LoungeState } from '$lib/protocol';
import type { Style } from '$lib/lounge/station';

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

export function nextRadioPick(now: RadioPick): RadioPick {
	return RADIO_PICKS[(RADIO_PICKS.indexOf(now) + 1) % RADIO_PICKS.length];
}
