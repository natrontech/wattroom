import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { roadMaterial } from './geometry';
import { RIDE } from './look.test-helper';
import { flat, makeSight } from './materials';
import * as P from './props';

/**
 * ADR-0092's look on the dressing and the road (#4256): low poly, flat
 * shaded, its colour flat per face, no detail painted inside a face, and
 * nothing drawn thinner than a pixel.
 */

const c = RIDE.props;
const TREES = {
	spruce: [P.spruce, P.spruceFar],
	spruceSlender: [P.spruceSlender, P.spruceSlenderFar],
	fir: [P.fir, P.firFar],
	broadleaf: [P.broadleaf, P.broadleafFar],
	broadleafRound: [P.broadleafRound, P.broadleafRoundFar],
	broadleafTall: [P.broadleafTall, P.broadleafTallFar],
} as const;

const triangles = (g: THREE.BufferGeometry) =>
	(g.index ? g.index.count : g.attributes.position.count) / 3;

/** Faces whose three corners carry more than one colour. */
function blended(g: THREE.BufferGeometry): number {
	const col = g.attributes.color;
	let n = 0;
	for (let v = 0; v < col.count; v += 3)
		for (let k = 0; k < 3; k++)
			if (
				col.getComponent(v + 1, k) !== col.getComponent(v, k) ||
				col.getComponent(v + 2, k) !== col.getComponent(v, k)
			) {
				n++;
				break;
			}
	return n;
}

describe('the dressing’s models (ADR-0092)', () => {
	it.each(Object.entries(TREES))(
		'%s is a handful of faces, each one colour, near and far',
		(_, [near, far]) => {
			const [n, f] = [near(c), far(c)];
			expect(blended(n)).toBe(0);
			expect(blended(f)).toBe(0);
			expect(triangles(n)).toBeLessThanOrEqual(80);
			expect(triangles(f)).toBeLessThanOrEqual(32);
		},
	);

	it('gives the triangles of one flat face one shade: a bale’s side, a rock’s pentagon', () => {
		for (const g of [P.bales(c), P.rock(c)]) {
			const pos = g.attributes.position;
			const col = g.attributes.color;
			const shade = new Map<string, number>();
			const face = new THREE.Triangle();
			const n = new THREE.Vector3();
			const p = new THREE.Vector3();
			let split = 0;
			for (let v = 0; v < pos.count; v += 3) {
				face.setFromAttributeAndIndices(pos, v, v + 1, v + 2).getNormal(n);
				const plane = `${n.toArray().map((x) => x.toFixed(3))}|${p.fromBufferAttribute(pos, v).dot(n).toFixed(2)}`;
				const was = shade.get(plane);
				if (was !== undefined && was !== col.getX(v)) split++;
				shade.set(plane, col.getX(v));
			}
			expect(split).toBe(0);
		}
	});

	it('lays the woodpile’s cover on its logs, never floating over them', () => {
		const pos = P.woodpile(c).attributes.position;
		const heights = [
			...new Set(Array.from({ length: pos.count }, (_, i) => pos.getY(i))),
		].sort((a, b) => a - b);
		const gap = Math.max(...heights.slice(1).map((y, i) => y - heights[i]));
		expect(gap).toBeLessThan(0.1);
	});

	it('paints its bales one colour per face, their rolled ends lighter', () => {
		const g = P.bales(c);
		expect(blended(g)).toBe(0);
		const tones = new Set<string>();
		const col = g.attributes.color;
		for (let v = 0; v < col.count; v += 3) tones.add(col.getX(v).toFixed(3));
		expect(tones.size).toBeGreaterThan(2);
		expect(triangles(g)).toBeLessThanOrEqual(3 * 32);
	});

	it('shades every face flat: one normal per face', () => {
		const sight = makeSight();
		for (const m of [flat(sight, { wind: true, fade: true }), flat(sight)]) {
			expect(m.flatShading).toBe(true);
			expect(m.map).toBeNull();
		}
	});
});

/** The road's fragment shader as three would compile it. */
function roadShader(): string {
	const m = roadMaterial(RIDE.road);
	const s = {
		uniforms: {},
		vertexShader: THREE.ShaderLib.lambert.vertexShader,
		fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
	} as unknown as THREE.WebGLProgramParametersWithUniforms;
	m.onBeforeCompile(s, {} as THREE.WebGLRenderer);
	return s.fragmentShader;
}

describe('the road’s paint (ADR-0092)', () => {
	it('paints no grain on the asphalt or the shoulder', () => {
		expect(roadShader()).not.toMatch(/grain|noise|fract\(sin/);
	});

	it('never draws a line narrower than a pixel, and fades the dashes to their average when they are too short to draw', () => {
		const f = roadShader();
		expect(f).toContain('float w = max(h, 0.5 * fw);');
		expect(f).toContain('* h / w');
		expect(f).toMatch(/float centre = paint\(abs\(u\), [\d.]+, fw\) \* dash;/);
		expect(f).toMatch(/mix\(paint\(along, [\d.]+, fs\), 0\.25,/);
	});
});
