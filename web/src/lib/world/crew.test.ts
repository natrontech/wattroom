import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { toRoute } from '$lib/road/route';
import { STYLES } from '../../routes/(app)/dev/world/styles';
import { makeCrew, type Pedalling } from './crew';
import { figurePalette } from './figure-palette';
import { inWattBand } from './placement/safety';
import { simRider, type SimRider } from './sim';
import { syntheticPoints } from './synthetic';

const style = STYLES.find((s) => s.id === 'bluehour') ?? STYLES[0];
const route = toRoute(syntheticPoints());

describe('the figure on its bike (#3673)', () => {
	it('paints no kit colour that reads as an identity’s watt, and the neutral skin', () => {
		for (let hue = 0; hue < 360; hue += 5)
			for (let variant = 0; variant < 16; variant++) {
				const palette = figurePalette(hue, style.kit, variant);
				const inBand = Object.entries(palette).filter(([, c]) =>
					inWattBand(`#${c.getHexString()}`),
				);
				expect(inBand.map(([slot]) => `${hue}/${variant}: ${slot}`)).toEqual(
					[],
				);
				expect(`#${palette.skin.getHexString()}`).toBe(style.kit.skin);
			}
	});

	it('draws you and the two riders nearest you in full detail, and re-ranks as they move', () => {
		const riders: SimRider[] = [0, 4, 9, 30, 60, 90].map((d, i) =>
			simRider({
				id: `r${i}`,
				name: `R${i}`,
				mass: 75,
				ftp: 250,
				you: i === 2,
				watts: 200,
				d: 1000 + d,
			}),
		);
		const legs = new Map<SimRider, Pedalling>();
		const pedal = (r: SimRider) =>
			legs.get(r) ?? legs.set(r, { crank: 0 }).get(r)!;
		const crew = makeCrew(style, new THREE.Color());
		// docs/SPEC.md "The world": LOD0 up to 14k triangles, LOD1 at most 7k.
		const detailed = () => {
			const ids: string[] = [];
			crew.group.traverse((o) => {
				if (
					o instanceof THREE.SkinnedMesh &&
					o.geometry.index!.count / 3 > 7000
				)
					ids.push(o.parent!.userData.rider);
			});
			return ids.sort();
		};
		crew.update(route, riders, pedal, 0.1, 0.1, false);
		expect(detailed()).toEqual(['r0', 'r1', 'r2']);

		// r5 rides up beside you, r1 falls back; a second on, the detail follows.
		riders[5].d = 1009.5;
		riders[1].d = 900;
		crew.update(route, riders, pedal, 1.1, 1.1, false);
		expect(detailed()).toEqual(['r0', 'r2', 'r5']);
	});
});
