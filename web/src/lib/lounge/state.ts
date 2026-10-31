/**
 * The lounge's shared lamp and weather as the client reads them (ADR-0094).
 */
import type { LoungeState } from '$lib/protocol';

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
