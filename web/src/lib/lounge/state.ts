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

/** The hub's LoungeRadioStyles, and '' for the mix that rotates them all. */
export const RADIO_PICKS: readonly (Style | '')[] = [
	'',
	'lofi',
	'chip',
	'ambient',
];
export type RadioPick = Style | '';

/** The style the channel picked; a word this build does not know plays the mix. */
export function radioPickOf(state: LoungeState | undefined): RadioPick {
	return RADIO_PICKS.find((known) => known === state?.radioStyle) ?? '';
}

export function nextRadioPick(now: RadioPick): RadioPick {
	return RADIO_PICKS[(RADIO_PICKS.indexOf(now) + 1) % RADIO_PICKS.length];
}
