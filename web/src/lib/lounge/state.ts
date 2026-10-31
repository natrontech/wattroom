/**
 * The lounge's shared lamp and weather as the client reads them (ADR-0094),
 * and the one thing about it this device keeps: whether house radio plays.
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

const RADIO_KEY = 'wattroom.lounge.radio.v1';

/** House radio is on unless this device turned it off. */
export function radioWanted(): boolean {
	try {
		return localStorage.getItem(RADIO_KEY) !== 'off';
	} catch {
		return true;
	}
}

export function setRadioWanted(on: boolean) {
	try {
		if (on) localStorage.removeItem(RADIO_KEY);
		else localStorage.setItem(RADIO_KEY, 'off');
	} catch {
		// Kept for this visit only.
	}
}
