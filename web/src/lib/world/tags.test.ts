// @vitest-environment happy-dom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CORRIDOR } from '$lib/session/docks';
import { STYLES } from '../../routes/(app)/dev/world/styles';
import type { SimRider } from './sim';
import { CHEVRON_Y, THUMB_Y } from './crew';
import { carriers, lay, makeTags, PILL_H, TEXT_H, textOf } from './tags';

const rider = (id: string, d: number, more: Partial<SimRider> = {}) =>
	({ id, name: id.toUpperCase(), d, you: false, ...more }) as SimRider;

describe('name tags over riders (#3086)', () => {
	it('hangs over the two riders nearest you and anyone speaking, never over you', () => {
		const riders = [
			rider('me', 100, { you: true }),
			rider('a', 104),
			rider('b', 92),
			rider('c', 130),
			rider('d', 300, { speaking: true }),
			rider('gone', 101, { alpha: 0 }),
		];
		expect(carriers(riders).map((r) => r.id)).toEqual(['a', 'b', 'd']);
	});

	it('reads the name, and the level where known', () => {
		expect(textOf(rider('ana', 0, { name: 'Ana', level: 38 }))).toBe(
			'Ana · Lv 38',
		);
		expect(textOf(rider('ben', 0, { name: 'Ben' }))).toBe('Ben');
	});

	it('merges tags that would overlap, and keeps apart those that would not', () => {
		const laid = lay(
			[
				{ text: 'Ana', speaking: false, x: 0.2, y: 0.3 },
				{ text: 'Ben', speaking: true, x: 0.21, y: 0.31 },
				{ text: 'Cy', speaking: false, x: 0.8, y: 0.3 },
			],
			16 / 10,
		);
		expect(laid.map((t) => t.text)).toEqual(['Ana / Ben', 'Cy']);
		expect(laid[0].speaking).toBe(true);
	});

	it('keeps to the upper half of the keep-clear corridor, clear of the panels beside it', () => {
		const middle = (CORRIDOR.y0 + CORRIDOR.y1) / 2;
		for (const x of [0.5, 0.2, 0.9]) {
			const [t] = lay([{ text: 'Ana', speaking: false, x, y: 0.6 }], 16 / 10);
			expect(t.y + PILL_H / 2).toBeLessThanOrEqual(middle + 1e-9);
			const half = (TEXT_H * 0.6 * 3 + PILL_H) / (16 / 10) / 2;
			expect(t.x - half).toBeGreaterThanOrEqual(CORRIDOR.x0 - 1e-9);
			expect(t.x + half).toBeLessThanOrEqual(CORRIDOR.x1 + 1e-9);
		}
	});

	it('stands over a cheer’s thumb while it shows, and over the chevron’s height otherwise', () => {
		const style = STYLES.find((s) => s.id === 'bluehour') ?? STYLES[0];
		const camera = new THREE.PerspectiveCamera(52, 16 / 10, 1, 1000);
		camera.position.set(0, 1.5, 8);
		camera.lookAt(0, 1.5, 0);
		camera.updateMatrixWorld();
		const at = () => new THREE.Vector3(0, 0, 0);
		const foot = (cheer: SimRider['cheer']) => {
			const tags = makeTags(style);
			tags.update(
				[rider('me', 0, { you: true }), rider('a', 1, { cheer })],
				at,
				camera,
				false,
			);
			const [s] = tags.group.children as THREE.Sprite[];
			return s.position.clone().project(camera).y - PILL_H;
		};
		const thumbTop = new THREE.Vector3(0, THUMB_Y + 0.16, 0).project(camera).y;
		const chevron = new THREE.Vector3(0, CHEVRON_Y + 0.2, 0).project(camera).y;
		expect(foot({ thumb: 1, alpha: 1, lit: true })).toBeGreaterThanOrEqual(
			thumbTop,
		);
		expect(foot(null)).toBeCloseTo(chevron, 5);
	});

	it('is at least 16 arcmin tall at the design distance: 18 px of text in a 900 px frame', () => {
		expect(TEXT_H * 900).toBeGreaterThanOrEqual(18);
	});

	it('draws each tag as a flat sprite, constant on screen, never additive', () => {
		const style = STYLES.find((s) => s.id === 'bluehour') ?? STYLES[0];
		const tags = makeTags(style);
		const camera = new THREE.PerspectiveCamera(52, 16 / 10, 1, 1000);
		camera.position.set(0, 3, 10);
		camera.lookAt(0, 1, 0);
		const riders = [
			rider('me', 0, { you: true }),
			rider('a', 1, { speaking: true }),
			rider('b', 2),
		];
		const at = (r: SimRider) =>
			new THREE.Vector3(r.id === 'a' ? -2 : r.id === 'b' ? 2 : 0, 0, 0);
		tags.update(riders, at, camera, false);
		const sprites = tags.group.children as THREE.Sprite[];
		expect(sprites.map((s) => s.userData.text).sort()).toEqual(['A', 'B']);
		for (const s of sprites) {
			expect(s.material.sizeAttenuation).toBe(false);
			expect(s.material.blending).toBe(THREE.NormalBlending);
		}
		expect(
			sprites.find((s) => s.userData.text === 'A')!.userData.speaking,
		).toBe(true);
		// The model view draws no tags.
		tags.update(riders, at, camera, true);
		expect(tags.group.children).toHaveLength(0);
	});
});
