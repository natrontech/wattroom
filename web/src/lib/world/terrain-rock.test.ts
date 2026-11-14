import { describe, expect, it } from 'vitest';
import { Biome } from './biome';
import {
	PIXEL_LAND,
	SNOW_TINT_LEAN,
	snowRockCut,
	landSheetLean,
	terrainMaterial,
} from './styles';
import { RIDE } from './look.test-helper';

describe('the ground material keys rock to slope (#3728)', () => {
	const m = terrainMaterial(RIDE);

	it('hands the shader the style’s rock colour', () => {
		expect(`#${m.uniforms.uRock.value.getHexString()}`).toBe(
			RIDE.palette[Biome.Rock].toLowerCase(),
		);
	});

	it('mixes rock in past the earthworks’ 45° face, one colour per face (ADR-0092)', () => {
		const f = m.fragmentShader;
		expect(f).toContain('smoothstep(0.86, 0.66, n.y)');
		expect(f).toContain('mix(uRock, vColor, 0.18), steep)');
		// No detail painted inside a face in Smooth: no noise, no masonry. Diorama 3D's land is its own.
		expect(f.replace(PIXEL_LAND, '')).not.toMatch(/fract\(sin|landHash\(/);
	});
});

describe('Diorama 3D’s snow is closed on gentle ground', () => {
	const up = (deg: number) => Math.cos((deg * Math.PI) / 180);

	it('lets no rock through a face under 10°: the facets never reach the cut', () => {
		// landFacet is under 1, so r = 0.72 a + 0.28 b is too: a cut of 1 or more draws no outcrop.
		for (const deg of [0, 4, 8, 10])
			expect(snowRockCut(up(deg))).toBeGreaterThanOrEqual(1);
	});

	it('lets no rock through a road’s cut or fill in the snow: closed up to 35°', () => {
		// The earthworks' 1:1.5 is 34°: their faces showed the stones through, in patches and specks.
		for (const deg of [20, 30, 34, 35])
			expect(snowRockCut(up(deg))).toBeGreaterThanOrEqual(1);
	});

	it('still shows rock on a crag and along a crest', () => {
		expect(snowRockCut(up(45))).toBeLessThan(0.75);
		expect(snowRockCut(up(60))).toBeLessThan(0);
		expect(snowRockCut(up(5), 1)).toBeLessThan(snowRockCut(up(5)) - 0.4);
	});

	/** The share of the sun's or the shade's tint a snow face of `deg` takes, as snowLand reads it. */
	const tint = (deg: number) => {
		const [a, b] = SNOW_TINT_LEAN.map(Number);
		const lean = Math.sin((deg * Math.PI) / 180) * landSheetLean(up(deg));
		const t = Math.min(1, Math.max(0, (lean - a) / (b - a)));
		return t * t * (3 - 2 * t);
	};

	it('tints a road’s cut and fill (up to 25°) at most half, a mountain’s wall whole', () => {
		expect(tint(25)).toBeLessThan(0.5);
		expect(tint(45)).toBe(1);
	});

	it('tints no face of closed snow, up to 35°: a pass’s slopes are one snowfield, not pink and lilac triangles', () => {
		for (const deg of [10, 20, 30, 35]) expect(tint(deg)).toBeLessThan(0.05);
	});

	it('lights the land as one sheet, meadow and snow alike: two faces turned to and from the sun differ by less than a band', () => {
		// Diorama 3D lights in four steps of a quarter (half-Lambert). Two 35° faces, one turned to a sun 30° up and one away, lit as they stand, were a band and more apart: a meadow's or a pass's 10 m faces a patchwork from a raised camera.
		const sun = (30 * Math.PI) / 180;
		const lam = (deg: number, to: 1 | -1, k = landSheetLean(up(deg))) => {
			const lean = Math.sin((deg * Math.PI) / 180) * k;
			const n = [to * lean, up(deg)];
			const len = Math.hypot(n[0], n[1]);
			return ((n[0] * Math.cos(sun) + n[1] * Math.sin(sun)) / len) * 0.5 + 0.5;
		};
		for (const deg of [15, 25, 35])
			expect(lam(deg, 1) - lam(deg, -1)).toBeLessThan(0.25);
		expect(lam(35, 1, 1) - lam(35, -1, 1)).toBeGreaterThan(0.25);
	});

	it('lights and tints a crag (from 45°) as it stands', () => {
		for (const deg of [45, 60, 80]) expect(landSheetLean(up(deg))).toBe(1);
		expect(landSheetLean(up(30))).toBeCloseTo(0.35);
	});

	it('tints no face that lies near flat', () => {
		expect(+SNOW_TINT_LEAN[0]).toBeGreaterThanOrEqual(
			Math.sin((8 * Math.PI) / 180),
		);
	});
});
