import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { toRoute } from '$lib/road/route';
import { makeCrew, type Pedalling } from './crew';
import { figurePalette } from './figure-palette';
import { inWattBand } from './placement/safety';
import { RIDE } from './look.test-helper';
import { simRider, type SimRider } from './sim';
import { syntheticPoints } from './synthetic';

const style = RIDE;
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

describe('a silent trainer (#3766)', () => {
	const you = () =>
		simRider({
			id: 'me',
			name: 'Me',
			mass: 75,
			ftp: 250,
			you: true,
			watts: 300,
			d: 1000,
		});
	const frame = (
		rider: SimRider,
		crew = makeCrew(style, new THREE.Color()),
	) => {
		const legs: Pedalling = { crank: 0 };
		crew.update(route, [rider], () => legs, 0.1, 0.1, false);
		const mesh = (kind: string) => {
			let found: THREE.Mesh | undefined;
			crew.group.traverse((o) => {
				if (o.userData.kind === kind) found = o as THREE.Mesh;
			});
			return found!;
		};
		let ring: THREE.Mesh | undefined;
		crew.group.traverse((o) => {
			if (o instanceof THREE.Mesh && o.geometry instanceof THREE.RingGeometry)
				ring = o;
		});
		const tone = (ring!.material as THREE.MeshBasicMaterial).color;
		return { tone: `#${tone.getHexString()}`, trail: mesh('trail') };
	};
	const zoneTones = style.zones.map(
		(z) => `#${new THREE.Color(z).getHexString()}`,
	);

	it('keeps its zone ring and its trail while the trainer speaks', () => {
		const { tone, trail } = frame(you());
		expect(zoneTones).toContain(tone);
		expect(trail.visible).toBe(true);
	});

	it('drops the ring to a tone no zone wears and stops the trail, and both come back with the next sample', () => {
		const crew = makeCrew(style, new THREE.Color());
		const rider = you();
		rider.silent = true;
		const quiet = frame(rider, crew);
		expect(zoneTones).not.toContain(quiet.tone);
		expect(quiet.trail.visible).toBe(false);

		rider.silent = false;
		const back = frame(rider, crew);
		expect(zoneTones).toContain(back.tone);
		expect(back.trail.visible).toBe(true);
	});
});
