// The ride's look (ADR-0072, #3085): Alpine blue hour, every colour an
// app.css token. The world's own are --world-*, single values that follow no
// theme; its accents — watt, neon, the zones — are the rider's theme's, read
// where the world is drawn, so inside the cave they are the dark half. The
// dev gallery's blue hour is this look, so what it shows is what a rider sees.
import { Biome } from './biome';
import { sunAzimuth, sunElevation } from './light';
import type { Style } from './styles';

/** A token's colour by its custom property's name, without the dashes: `world-sky-zenith`, `color-watt`. */
export type Paint = (token: string) => string;

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
		},
		grid: null,
		contours: null,
		imhof: null,
		road: {
			asphalt: w('road-asphalt'),
			line: w('road-line'),
			verge: w('road-verge'),
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
	};
}

/** The ride's look as the page paints it under `el`: inside the cave, its accents are the dark half. */
export function readLook(el: Element): Style {
	const probe = document.createElement('span');
	probe.hidden = true;
	el.append(probe);
	try {
		return rideLook((token) => {
			probe.style.color = `var(--${token})`;
			return getComputedStyle(probe).color;
		});
	} finally {
		probe.remove();
	}
}
