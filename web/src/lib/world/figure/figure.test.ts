import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FRAMES, type FrameId } from './bikes/presets';
import { B, BONES, S } from './contract';
import { buildFigure } from './figure';
import { resolveKit } from './kit';

const frames = Object.keys(FRAMES) as FrameId[];
const triangles = (m: THREE.Mesh) => m.geometry.index!.count / 3;

describe('one skinned figure and bike per draw', () => {
	it('keeps model.js’s 18 bones in their order, then fork and hands', () => {
		expect(BONES).toHaveLength(21);
		// prettier-ignore
		expect(BONES.slice(0, 18)).toEqual([
			'root', 'bike', 'frontWheel', 'rearWheel', 'crank', 'pelvis', 'torso', 'head',
			'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'armL', 'foreL', 'armR', 'foreR',
		]);
		expect(BONES.slice(18)).toEqual(['fork', 'handL', 'handR']);
		const m = buildFigure(resolveKit());
		expect(m.skeleton.bones.map((b) => b.name)).toEqual([...BONES]);
	});

	// docs/SPEC.md proposal (#3070): LOD0 at most 14k triangles per figure
	// and bike, LOD1 6.4–7.0k — the lighter bikes land under the floor.
	for (const id of frames)
		it(`stays in the triangle budget on the ${id}`, () => {
			expect(
				triangles(buildFigure(resolveKit(id), { lod: 0 })),
			).toBeLessThanOrEqual(14000);
			expect(
				triangles(buildFigure(resolveKit(id), { lod: 1 })),
			).toBeLessThanOrEqual(7000);
		});

	it('puts the starter figure’s LOD1 in 6.4–7.0k, and the heaviest kit under 14k', () => {
		const lod1 = triangles(buildFigure(resolveKit(), { lod: 1 }));
		expect(lod1).toBeGreaterThanOrEqual(6400);
		expect(lod1).toBeLessThanOrEqual(7000);
		const heaviest = resolveKit('gravel', {
			helmet: 'aero',
			glasses: 'round',
			hair: 'ponytail',
			gloves: 'full',
			shoes: 'laced',
			bottles: 'two',
			socks: { height: 0.13, stripe: true },
			jersey: { sleeves: 'long' },
			shorts: 'knicker',
		});
		expect(triangles(buildFigure(heaviest, { lod: 0 }))).toBeLessThanOrEqual(
			14000,
		);
	});

	it('skins the knees, elbows and waist smoothly across two bones', () => {
		const g = buildFigure(resolveKit()).geometry;
		const si = g.attributes.skinIndex;
		const sw = g.attributes.skinWeight;
		const blended = (a: number, b: number) => {
			let n = 0;
			for (let i = 0; i < si.count; i++)
				if (
					si.getX(i) === a &&
					si.getY(i) === b &&
					sw.getX(i) > 0.01 &&
					sw.getY(i) > 0.01
				)
					n++;
			return n;
		};
		expect(blended(B.thighR, B.shinR)).toBeGreaterThan(0);
		expect(blended(B.thighL, B.shinL)).toBeGreaterThan(0);
		expect(blended(B.armR, B.foreR)).toBeGreaterThan(0);
		expect(blended(B.pelvis, B.torso)).toBeGreaterThan(0);
	});

	it('grows with the rider’s height and fills out with the build', () => {
		const top = (m: THREE.Mesh) => {
			m.geometry.computeBoundingBox();
			return m.geometry.boundingBox!;
		};
		const short = top(buildFigure(resolveKit(), { body: { height: 1.55 } }));
		const tall = top(buildFigure(resolveKit(), { body: { height: 2.0 } }));
		expect(tall.max.y - short.max.y).toBeGreaterThan(0.2);
		const width = (build: 'slim' | 'strong') => {
			const g = buildFigure(resolveKit(), { body: { build } }).geometry;
			const p = g.attributes.position;
			const si = g.attributes.skinIndex;
			let w = 0;
			for (let i = 0; i < p.count; i++)
				// The torso's vertices ride the waist: pelvis first, torso second.
				if (si.getY(i) === B.torso) w = Math.max(w, Math.abs(p.getZ(i)));
			return w;
		};
		expect(width('strong')).toBeGreaterThan(width('slim'));
	});

	it('ends the jersey on the shorts, fitted to the hips, never over the saddle (#3772)', () => {
		const m = buildFigure(resolveKit());
		const { k } = m.userData.rig.dims;
		const g = m.geometry;
		const p = g.attributes.position;
		const slot = g.attributes.slot;
		const bone = g.attributes.skinIndex;
		// The bind pose in the pelvis's own space: y up the spine from the hip centre, z across.
		const toPelvis = m.skeleton.boneInverses[B.pelvis];
		const v = new THREE.Vector3();
		let lowest = Infinity;
		let widest = 0;
		let hips = 0;
		for (let i = 0; i < p.count; i++) {
			v.fromBufferAttribute(p, i).applyMatrix4(toPelvis);
			const s = slot.getX(i);
			// The sleeves ride the arms, which bind elsewhere.
			const trunk = [B.pelvis, B.torso].includes(bone.getX(i));
			if (s === S.jersey && trunk) {
				lowest = Math.min(lowest, v.y);
				if (v.y < 0) widest = Math.max(widest, Math.abs(v.z));
			}
			if (s === S.shorts && v.y < 0 && v.y > -0.06 * k)
				hips = Math.max(hips, Math.abs(v.z));
		}
		expect(lowest).toBeGreaterThan(-0.05 * k);
		expect(widest - hips).toBeLessThan(0.012 * k);
	});

	it('stands in its bind pose until a pose is written', () => {
		const m = buildFigure(resolveKit());
		m.updateMatrixWorld(true);
		m.skeleton.update();
		const p = m.geometry.attributes.position;
		for (const i of [0, Math.floor(p.count / 2), p.count - 1]) {
			const v = new THREE.Vector3().fromBufferAttribute(p, i);
			const skinned = m.applyBoneTransform(i, v.clone());
			expect(skinned.distanceTo(v)).toBeLessThan(1e-6);
		}
	});

	it('keeps every module under 300 lines', () => {
		for (const f of readdirSync(__dirname).filter(
			(f) => f.endsWith('.ts') && !f.includes('.test'),
		))
			expect(
				readFileSync(join(__dirname, f), 'utf8').split('\n').length,
				f,
			).toBeLessThanOrEqual(300);
	});
});
