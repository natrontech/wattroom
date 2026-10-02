// The ride's light (ADR-0072, docs/SPEC.md "The world"): the sun below the
// horizon, sinking with the ride's progress, and the sky the only light — no
// key, no shadow, stars only once the zenith has darkened. A look whose sun
// is up, a desk preview's, keeps its own sun and its own light.
import SunCalc from 'suncalc';
import * as THREE from 'three';
import type { Style } from './styles';

/** Where the sun stands with no place to compute it from: west-south-west, an evening's. */
export const DEFAULT_AZIMUTH = 250;

/** How much of the sky's light each degree the sun sinks below −4° takes: first night is visibly darker. */
const DUSK_PER_DEG = 0.11;

/**
 * The zenith's relative luminance (linear) at which the first star shows,
 * and at which they all have. The ride's zenith token passes the first at
 * about −5° and the second at about −8°.
 */
const STARS_FROM = 0.066;
const STARS_FULL = 0.042;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The sun's elevation in degrees for a ride's progress 0–1: −4° at the start, −8° at the finish, −6° with no known end. */
export function sunElevation(p: number | null): number {
	return p === null ? -6 : -4 - 4 * clamp01(p);
}

/**
 * The sun's real bearing at dusk (−6°), degrees clockwise from north, at a
 * place rounded to 0.1° on `date`. The default with no place, or where the
 * sun does not sink that far that day.
 */
export function sunAzimuth(
	place: { lat: number; lon: number } | null,
	date: Date,
): number {
	if (!place) return DEFAULT_AZIMUTH;
	const lat = Math.round(place.lat * 10) / 10;
	const lon = Math.round(place.lon * 10) / 10;
	const { dusk } = SunCalc.getTimes(date, lat, lon);
	if (Number.isNaN(dusk.getTime())) return DEFAULT_AZIMUTH;
	// SunCalc's azimuth is radians from south, positive toward the west.
	const { azimuth } = SunCalc.getPosition(dusk, lat, lon);
	return ((azimuth * 180) / Math.PI + 540) % 360;
}

/** Toward the sun from its elevation and bearing, degrees: north is −z, east +x. */
export function sunDir(elevation: number, azimuth: number): THREE.Vector3 {
	const e = (elevation * Math.PI) / 180;
	const a = (azimuth * Math.PI) / 180;
	return new THREE.Vector3(
		Math.sin(a) * Math.cos(e),
		Math.sin(e),
		-Math.cos(a) * Math.cos(e),
	).normalize();
}

export type Light = {
	/** Toward the sun, set or not: the sky's glow and the fog lean to it. */
	sun: THREE.Vector3;
	/** Where the light falls from: the sun while it is up, the zenith once it has set. */
	from: THREE.Vector3;
	/** What the sky still gives, 1 down to −4°. */
	dusk: number;
	/** The peach band's strength, fading as the sun sinks. */
	peach: number;
	/** The stars' opacity, by the zenith's luminance. */
	stars: number;
	/** The sun is up: a key light and its bands. */
	keyed: boolean;
};

/** The light a look gives at a ride's progress (null: no known end). */
export function lightAt(style: Style, p: number | null): Light {
	const keyed = style.sun.elevation >= 0;
	const elevation = keyed ? style.sun.elevation : sunElevation(p);
	const sun = sunDir(elevation, style.sun.azimuth);
	const dusk = keyed ? 1 : Math.min(1, 1 + (elevation + 4) * DUSK_PER_DEG);
	const zenith = new THREE.Color(style.sky.top).multiplyScalar(dusk);
	const y = 0.2126 * zenith.r + 0.7152 * zenith.g + 0.0722 * zenith.b;
	return {
		sun,
		from: keyed ? sun.clone() : new THREE.Vector3(0, 1, 0),
		dusk,
		peach: style.sky.band ? clamp01((elevation + 10) / 6) : 0,
		stars: style.stars
			? clamp01((STARS_FROM - y) / (STARS_FROM - STARS_FULL))
			: 0,
		keyed,
	};
}
