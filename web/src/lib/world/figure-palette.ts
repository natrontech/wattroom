// A figure's colours (ADR-0073), until #3156 dresses it from the wardrobe:
// one identity hue per rider for the kit, the look's own greys and blacks for
// the bike's parts, and the neutral skin every rider wears who has not
// chosen one (#3413). Every colour keeps clear of the watt band (O13), so no
// kit reads as live data; the zone stays on the ring under the wheels.
import * as THREE from 'three';
import type { Palette } from './figure/figure';
import { inWattBand } from './placement/safety';
import type { RiderKit } from './styles';

/** Degrees a colour's hue turns, each try, to leave the watt band. */
const STEP = 30;

/** `c`, turned round the wheel until it no longer reads as any identity's watt. */
export function clearOfWatt(c: THREE.Color): THREE.Color {
	const hsl = { h: 0, s: 0, l: 0 };
	for (let k = 0; k < 360 / STEP && inWattBand(`#${c.getHexString()}`); k++) {
		c.getHSL(hsl);
		c.setHSL((hsl.h + STEP / 360) % 1, hsl.s, hsl.l);
	}
	return c;
}

/** A rider's palette from their identity hue and the look's kit. */
export function figurePalette(hue: number, kit: RiderKit): Palette {
	const c = (h: number, s: number, l: number) =>
		clearOfWatt(
			new THREE.Color().setHSL((((h % 360) + 360) % 360) / 360, s, l),
		);
	const k = (hex: string) => new THREE.Color(hex);
	const jersey = c(hue, 0.62, 0.56);
	const accent = c(hue, 0.5, 0.34);
	const shorts = c(hue, 0.35, 0.16);
	const helmet = c(hue + 150, 0.6, 0.6);
	return {
		jersey,
		jerseyAccent: accent,
		helmet,
		helmetAccent: c(hue + 150, 0.4, 0.3),
		skin: k(kit.skin),
		hair: k(kit.glasses),
		shorts,
		shortsAccent: accent.clone(),
		sock: k(kit.shoe),
		sockAccent: jersey.clone(),
		shoe: k(kit.shoe),
		sole: k(kit.tyre),
		glove: shorts.clone(),
		glasses: k(kit.glasses),
		lens: k(kit.glasses),
		// A dark frame with a touch of the kit's hue: a road bike at chase distance.
		frame: c(hue + 40, 0.25, 0.16),
		frameAccent: accent.clone(),
		saddle: k(kit.tyre),
		barTape: k(kit.tyre),
		hood: k(kit.tyre),
		leather: k(kit.tyre),
		bottle: k(kit.shoe),
		bottleCap: k(kit.tyre),
		tyre: k(kit.tyre),
		tyreWall: k(kit.tyre),
		rim: k(kit.rim),
		spokes: k(kit.metal),
		metal: k(kit.metal),
		groupset: k(kit.metal),
		chain: k(kit.metal),
	};
}
