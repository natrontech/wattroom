import * as THREE from 'three';
import { A0, type Aux } from './contract';
import { TAU, V } from './math';
import type { MeshBuilder, ProfilePoint } from './mesh';

/** A (radius, z) profile revolved about the bone's local Z: wheels, discs, hubs, bottles. */
export function revolve(
	mb: MeshBuilder,
	prof: ProfilePoint[],
	bone: number,
	o: {
		segments?: number;
		m?: THREE.Matrix4;
		closed?: boolean;
		phase?: number;
		aux?: Aux;
		outward?: (p: ProfilePoint) => [number, number];
	} = {},
): void {
	const seg = o.segments ?? 32;
	const R = mb.rest[bone].clone().multiply(o.m ?? new THREE.Matrix4());
	const nm = new THREE.Matrix3().getNormalMatrix(R);
	const np = prof.length;
	const cz = prof.reduce((s, p) => s + p.z, 0) / np;
	const cr = prof.reduce((s, p) => s + p.r, 0) / np;
	const same = (a: ProfilePoint, b: ProfilePoint) =>
		Math.abs(a.r - b.r) < 1e-7 && Math.abs(a.z - b.z) < 1e-7;
	const normals = prof.map((p, i): [number, number] => {
		if (p.n) return p.n;
		const prev =
			i > 0 && !same(prof[i - 1], p)
				? prof[i - 1]
				: o.closed && i === 0
					? prof[np - 1]
					: p;
		const next =
			i < np - 1 && !same(prof[i + 1], p)
				? prof[i + 1]
				: o.closed && i === np - 1
					? prof[0]
					: p;
		let tr = next.r - prev.r;
		let tz = next.z - prev.z;
		if (Math.hypot(tr, tz) < 1e-9) {
			tr = 1;
			tz = 0;
		}
		let nr = tz;
		let nz = -tr;
		const [outR, outZ] = o.outward ? o.outward(p) : [p.r - cr, p.z - cz];
		if (nr * outR + nz * outZ < 0) {
			nr = -nr;
			nz = -nz;
		}
		const l = Math.hypot(nr, nz);
		return [nr / l, nz / l];
	});
	const base = mb.n;
	const lp = V();
	const wp = V();
	const nn = V();
	for (let s = 0; s < seg; s++) {
		const ph = (s / seg) * TAU + (o.phase ?? 0);
		const c = Math.cos(ph);
		const sn = Math.sin(ph);
		for (let i = 0; i < np; i++) {
			const p = prof[i];
			lp.set(p.r * c, p.r * sn, p.z);
			if (o.m) lp.applyMatrix4(o.m);
			wp.copy(lp).applyMatrix4(mb.rest[bone]);
			nn.set(normals[i][0] * c, normals[i][0] * sn, normals[i][1])
				.applyMatrix3(nm)
				.normalize();
			mb.vert(
				wp,
				nn,
				[bone],
				[1],
				p.slot,
				V(p.r * c, p.r * sn, p.z),
				p.aux ?? o.aux ?? A0,
			);
		}
	}
	const e = o.closed ? np : np - 1;
	for (let s = 0; s < seg; s++)
		for (let i = 0; i < e; i++) {
			const i1 = (i + 1) % np;
			if (same(prof[i], prof[i1])) continue;
			const s1 = (s + 1) % seg;
			const a = base + s * np + i;
			const b = base + s1 * np + i;
			const c = base + s1 * np + i1;
			const d = base + s * np + i1;
			mb.orient(a, b, c);
			mb.orient(a, c, d);
		}
}
