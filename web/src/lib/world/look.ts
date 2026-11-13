// The ride's look (ADR-0072, #3085): Alpine blue hour, every colour an
// app.css token. The world's own are --world-*, single values that follow no
// theme; its accents — watt, neon, the zones — are the rider's theme's dark
// half, read inside the cave where the world is drawn. The
// dev gallery's blue hour is this look, so what it shows is what a rider sees.
import * as THREE from 'three';
import { Biome } from './biome';
import { sunAzimuth, sunElevation } from './light';
import type { Style } from './styles';

/** A token's colour by its custom property's name, without the dashes: `world-sky-zenith`, `color-watt`. */
export type Paint = (token: string) => string;

/** The tokens Diorama 3D paints in the room's window colours: app.css's --world-px-*. */
const PIXEL_TOKENS = new Set(
	[
		'sky-zenith',
		'sky-haze',
		'sky-peach',
		'sky-light',
		'sky-shade',
		'biome-water',
		'biome-meadow',
		'biome-forest',
		'biome-alpine',
		'biome-rock',
		'biome-snow',
		'biome-verge',
		'biome-moor',
		'biome-dry',
		'ridge',
		'ridge-rock',
		'road-asphalt',
		'road-line',
		'road-shoulder',
		'road-verge',
		'prop-spruce',
		'prop-spruce-tip',
		'prop-leaf',
		'prop-leaf-light',
		'prop-trunk',
		'prop-wall',
		'prop-wood',
		'prop-roof',
		'prop-stone',
		'prop-shutter',
		'prop-rock',
	].map((t) => `world-${t}`),
);

/** `paint`, in the room's window colours. */
export const pixelPaint =
	(paint: Paint): Paint =>
	(token) =>
		paint(
			PIXEL_TOKENS.has(token) ? token.replace('world-', 'world-px-') : token,
		);

/**
 * Diorama 3D's look, every ride's: the room's window colours under a low sun, the
 * hour before it sets, sinking with the ride. The lit side of everything warm, its shade the
 * room's violet, a peach sky at the horizon.
 */
export function dioramaLook(
	paint: Paint,
	{ night = false, weather = 'clear' }: DioramaSky = {},
): Style {
	const look = rideLook(pixelPaint(paint));
	const d = (token: string) => paint(`world-dio-${token}`);
	const day: Style = {
		...look,
		id: 'diorama',
		label: 'Diorama',
		sky: {
			top: d('sky-zenith'),
			horizon: d('sky-horizon'),
			sunward: d('sky-sunward'),
			band: d('sky-band'),
		},
		// Low, and lower by the finish: it touches the ranges as a ride with a known end ends.
		sun: {
			...look.sun,
			elevation: 12,
			sets: 3,
			disc: 'halo',
			color: d('sun'),
		},
		key: d('sky-light'),
		shade: d('sky-shade'),
		skyFill: 0.22,
		fogK: 0.7e-4,
		road: {
			...look.road,
			asphalt: d('road-asphalt'),
			shoulder: d('road-shoulder'),
		},
		// Real ranges: snow-capped and standing nearly twice as tall.
		backdrop: { ...look.backdrop, snowCaps: true, tall: 1.9 },
	};
	return weathered(night ? nightOf(day, paint) : day, weather, paint);
}

/** What the clock and the room give a Diorama ride: night by the rider's hour, the room's weather. */
export type DioramaSky = {
	night?: boolean;
	weather?: 'rain' | 'snow' | 'clear';
};

/** Two colours mixed in sRGB, `t` of the way from `a` to `b`. */
const mixed = (a: string, b: string, t: number) =>
	`#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;

/**
 * Diorama 3D at night, the room's night (lounge/palette.ts): its sky's
 * bands, set well under the horizon so the villages' lamps are lit and the
 * stars are out, moonlight in place of the sun, and the room's moon.
 */
function nightOf(day: Style, paint: Paint): Style {
	const n = (token: string) => paint(`world-dio-night-${token}`);
	return {
		...day,
		id: 'diorama-night',
		label: 'Diorama night',
		sky: {
			top: n('sky-zenith'),
			horizon: n('sky-horizon'),
			sunward: n('sky-horizon'),
			band: n('sky-horizon'),
		},
		sun: { ...day.sun, elevation: -7, sets: -7, disc: 'none' },
		key: n('moonlight'),
		shade: n('sky-shade'),
		moon: n('moon'),
		fogK: day.fogK * 1.4,
	};
}

/**
 * The room's weather over a look: rain greys the sky and thickens the haze;
 * snow greys it paler and lays snow on the land. Either hides the sun, and
 * the pass draws what falls (diorama.ts).
 */
function weathered(
	look: Style,
	weather: DioramaSky['weather'],
	paint: Paint,
): Style {
	if (weather !== 'rain' && weather !== 'snow') return look;
	const w = (token: string) => paint(`world-dio-${weather}-${token}`);
	const overcast = w('overcast');
	const grey = (c: string, t: number) => mixed(c, overcast, t);
	const snowy = (c: string) =>
		weather === 'snow' ? mixed(c, paint('world-px-biome-snow'), 0.62) : c;
	return {
		...look,
		weather,
		sky: {
			top: grey(look.sky.top, 0.55),
			horizon: grey(look.sky.horizon, 0.7),
			sunward: grey(look.sky.horizon, 0.7),
			band: grey(look.sky.horizon, 0.7),
		},
		sun: { ...look.sun, disc: 'none' },
		key: grey(look.key, 0.45),
		fogK: look.fogK * (weather === 'rain' ? 2.6 : 2),
		palette: Object.fromEntries(
			Object.entries(look.palette).map(([b, c]) =>
				Number(b) === Biome.Water || Number(b) === Biome.Rock
					? [b, c]
					: [b, snowy(c)],
			),
		) as Style['palette'],
		road: {
			...look.road,
			verge: snowy(look.road.verge),
			shoulder: look.road.shoulder && snowy(look.road.shoulder),
		},
	};
}

/** The ride's look, its colours from `paint`; the sun's bearing is the real one at `place`, when there is one. */
export function rideLook(
	paint: Paint,
	place: { lat: number; lon: number } | null = null,
	date = new Date(),
): Style {
	const w = (token: string) => paint(`world-${token}`);
	const haze = w('sky-haze');
	return {
		id: 'bluehour',
		label: 'Alpine blue hour',
		ride: true,
		sky: {
			top: w('sky-zenith'),
			horizon: haze,
			sunward: haze,
			band: w('sky-peach'),
		},
		// Set: the sky alone lights it, and the ride's progress moves it (light.ts).
		sun: {
			elevation: sunElevation(null),
			azimuth: sunAzimuth(place, date),
			disc: 'none',
			color: w('sky-peach'),
		},
		fogK: 1.2e-4,
		bands: 0,
		shade: w('sky-shade'),
		skyFill: 0.12,
		key: w('sky-light'),
		palette: {
			[Biome.Water]: w('biome-water'),
			[Biome.Meadow]: w('biome-meadow'),
			[Biome.Forest]: w('biome-forest'),
			[Biome.Alpine]: w('biome-alpine'),
			[Biome.Rock]: w('biome-rock'),
			[Biome.Snow]: w('biome-snow'),
			[Biome.Verge]: w('biome-verge'),
			[Biome.Moor]: w('biome-moor'),
			[Biome.Dry]: w('biome-dry'),
			[Biome.Frost]: w('biome-snow'),
		},
		grid: null,
		contours: null,
		imhof: null,
		road: {
			asphalt: w('road-asphalt'),
			line: w('road-line'),
			verge: w('road-verge'),
			shoulder: w('road-shoulder'),
		},
		props: {
			spruce: w('prop-spruce'),
			spruceTip: w('prop-spruce-tip'),
			leaf: w('prop-leaf'),
			leafLight: w('prop-leaf-light'),
			trunk: w('prop-trunk'),
			wall: w('prop-wall'),
			wood: w('prop-wood'),
			roof: w('prop-roof'),
			stone: w('prop-stone'),
			shutter: w('prop-shutter'),
			flower: w('prop-flower'),
			cow: w('prop-cow'),
			cowPatch: w('prop-cow-patch'),
			bell: w('prop-bell'),
			bale: w('prop-bale'),
			baleLight: w('prop-bale-light'),
			post: w('prop-post'),
			band: w('prop-band'),
			reflector: w('prop-reflector'),
			pole: w('prop-pole'),
			hiking: w('prop-hiking'),
			warning: w('prop-warning'),
			water: w('prop-water'),
			snowpole: w('prop-snowpole'),
			flags: [w('flag-1'), w('flag-2'), w('flag-3'), w('flag-4')],
			rock: w('prop-rock'),
		},
		kit: {
			skin: w('kit-skin'),
			shoe: w('kit-shoe'),
			tyre: w('kit-tyre'),
			rim: w('kit-rim'),
			metal: w('kit-metal'),
			glasses: w('kit-glasses'),
			tailLight: w('kit-tail-light'),
		},
		zones: [1, 2, 3, 4, 5, 6, 7].map((z) => paint(`color-z${z}`)),
		trail: paint('color-watt'),
		plinth: null,
		// Opaque silhouettes, paler and bluer with each ring as the haze takes them; no snow stripes.
		backdrop: {
			ridge: w('ridge'),
			rock: w('ridge-rock'),
			snow: w('biome-snow'),
			snowCaps: false,
		},
		stars: w('sky-stars'),
		signs: {
			pass: { bg: w('sign-blue'), fg: w('sign-white'), post: w('sign-post') },
			village: {
				bg: w('sign-blue'),
				fg: w('sign-white'),
				post: w('sign-post'),
			},
			climb: {
				bg: w('sign-chrome'),
				fg: w('sign-white'),
				post: w('sign-chrome-post'),
			},
			hairpin: { bg: w('sign-white'), fg: w('sign-ink'), post: w('sign-post') },
		},
		arch: {
			chrome: w('arch-chrome'),
			panel: w('sign-chrome'),
			stripe: paint('color-neon'),
			text: w('sign-white'),
		},
		tag: {
			bg: paint('color-surface'),
			line: paint('color-neon'),
			ink: paint('color-ink'),
		},
	};
}

/**
 * The world's colours as the page paints them under `el`, read inside the
 * cave: the world is blue hour in either scheme (ADR-0072), so its accents
 * and name tags are the dark half even while the page around it is light
 * (#4160).
 */
export function worldPaint(el: Element): Paint {
	return (token) => {
		const probe = document.createElement('span');
		probe.className = 'cave';
		probe.hidden = true;
		probe.style.color = `var(--${token})`;
		el.append(probe);
		try {
			return getComputedStyle(probe).color;
		} finally {
			probe.remove();
		}
	};
}

/** The ride's look as the world paints it under `el`. */
export function readLook(el: Element): Style {
	return rideLook(worldPaint(el));
}
