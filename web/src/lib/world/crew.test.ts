import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { toRoute } from '$lib/road/route';
import { makeCrew, type Pedalling } from './crew';
import { RIDE } from './look.test-helper';
import { simRider, type SimRider } from './sim';
import { syntheticPoints } from './synthetic';
import { seededLoadout } from './loadout';

const style = RIDE;
const route = toRoute(syntheticPoints());
const rider = (i: number, d: number, you = false) =>
	simRider({
		id: `r${i}`,
		name: `R${i}`,
		mass: 75,
		ftp: 250,
		you,
		watts: 200,
		d,
	});
const legs = new Map<SimRider, Pedalling>();
const pedal = (r: SimRider) => legs.get(r) ?? legs.set(r, { crank: 0 }).get(r)!;
const figures = (crew: ReturnType<typeof makeCrew>) => {
	const out = new Map<string, THREE.SkinnedMesh>();
	crew.group.traverse((o) => {
		if (o instanceof THREE.SkinnedMesh) out.set(o.parent!.userData.rider, o);
	});
	return out;
};

describe('the figure on its bike (#3673)', () => {
	it('draws you and the two riders nearest you in full detail, and re-ranks as they move', () => {
		const riders = [0, 4, 9, 30, 60, 90].map((d, i) =>
			rider(i, 1000 + d, i === 2),
		);
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

describe('outfits on the figure (#3156)', () => {
	it('dresses riders of one look from one build, each in their own copy', () => {
		const look = seededLoadout('shared');
		const [a, b] = [rider(0, 1000, true), rider(1, 1004)];
		a.look = b.look = look;
		const crew = makeCrew(style, new THREE.Color());
		crew.update(route, [a, b], pedal, 0.1, 0.1, false);
		const colours = () =>
			[...figures(crew).values()].map((f) =>
				Array.from(f.geometry.getAttribute('color').array.slice(0, 30)),
			);
		const [ca, cb] = colours();
		expect(ca).toEqual(cb);

		// One rider's screen goes: only their kit greys.
		b.faded = true;
		crew.update(route, [a, b], pedal, 0.1, 0.1, false);
		const [fa, fb] = colours();
		expect(fa).toEqual(ca);
		expect(fb).not.toEqual(cb);
	});

	it('shows no kit colour that reads as live data to its viewer', () => {
		const crew = makeCrew(style, new THREE.Color());
		const crowd = Array.from({ length: 12 }, (_, i) =>
			rider(i, 1000 + i * 3, i === 0),
		);
		crew.update(route, crowd, pedal, 0.1, 0.1, false);
		expect(crew.kitCollisions()).toBe(0);
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
