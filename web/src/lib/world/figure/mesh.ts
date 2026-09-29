import * as THREE from 'three';
import { A0, type Aux } from './contract';
import { V, Y_, Z_ } from './math';

/**
 * The figure's mesh builder (#3070): every part of a figure and its bike is
 * written into one set of buffers, rigidly or smoothly skinned to the bones
 * below, and becomes ONE SkinnedMesh — one draw call per rider. Parts are
 * authored in their bone's rest space and stored in bike space.
 */

/** Skin weights for a point: which bones, and how much of each. */
export type Weights = (p: THREE.Vector3) => [number[], number[]];

export type Ring = {
	pts: THREE.Vector3[];
	pc: THREE.Vector3[] | null;
	c: THREE.Vector3;
	bones: number[];
	w: number[];
	slot: number;
	aux?: Aux;
	seam?: boolean;
};

export type ProfilePoint = {
	r: number;
	z: number;
	slot: number;
	aux?: Aux;
	/** A fixed normal, as (radial, axial). */
	n?: [number, number];
};

export class MeshBuilder {
	P: number[] = [];
	N: number[] = [];
	SI: number[] = [];
	SW: number[] = [];
	SL: number[] = [];
	PC: number[] = [];
	AX: number[] = [];
	I: number[] = [];

	constructor(
		/** Each bone's rest transform: parts are authored in it. */
		readonly rest: THREE.Matrix4[],
		/** 0 up close; 1 has fewer sides and samples everywhere. */
		readonly lod: 0 | 1,
	) {}

	get n() {
		return this.P.length / 3;
	}

	vert(
		p: THREE.Vector3,
		nr: THREE.Vector3,
		bones: number[],
		w: number[],
		slot: number,
		pc: THREE.Vector3,
		aux: Aux = A0,
	): number {
		this.P.push(p.x, p.y, p.z);
		this.N.push(nr.x, nr.y, nr.z);
		this.SI.push(bones[0] ?? 0, bones[1] ?? 0, 0, 0);
		this.SW.push(w[0] ?? 1, w[1] ?? 0, 0, 0);
		this.SL.push(slot);
		this.PC.push(pc.x, pc.y, pc.z);
		this.AX.push(aux[0], aux[1], aux[2]);
		return this.n - 1;
	}

	/** A three.js geometry authored in `bone`'s rest space, optionally placed by `m`. */
	geo(
		g: THREE.BufferGeometry,
		bone: number,
		slot: number,
		m: THREE.Matrix4 | null = null,
		o: { weights?: Weights; aux?: Aux } = {},
	): void {
		const pos = g.attributes.position;
		if (!g.attributes.normal) g.computeVertexNormals();
		const nor = g.attributes.normal;
		const M = m ? m.clone() : new THREE.Matrix4();
		const full = this.rest[bone].clone().multiply(M);
		const nm = new THREE.Matrix3().getNormalMatrix(full);
		const flip = M.determinant() < 0;
		const base = this.n;
		const lp = V();
		const wp = V();
		const nn = V();
		for (let i = 0; i < pos.count; i++) {
			lp.fromBufferAttribute(pos, i).applyMatrix4(M);
			wp.copy(lp).applyMatrix4(this.rest[bone]);
			nn.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
			const wv = o.weights ? o.weights(wp) : null;
			this.vert(
				wp,
				nn,
				wv ? wv[0] : [bone],
				wv ? wv[1] : [1],
				slot,
				lp,
				o.aux ?? A0,
			);
		}
		const idx = g.index;
		const count = idx ? idx.count : pos.count;
		const at = (i: number) => (idx ? idx.getX(i) : i);
		for (let i = 0; i < count; i += 3) {
			const a = base + at(i);
			const b = base + at(i + 1);
			const c = base + at(i + 2);
			if (flip) this.I.push(a, c, b);
			else this.I.push(a, b, c);
		}
		g.dispose();
	}

	point(i: number) {
		return V(this.P[i * 3], this.P[i * 3 + 1], this.P[i * 3 + 2]);
	}

	/** Rings of equal size joined into a skin, faces turned away from the rings' centres. */
	loft(
		rings: Ring[],
		o: { capStart?: THREE.Vector3 | null; capEnd?: THREE.Vector3 | null } = {},
	): void {
		const sides = rings[0].pts.length;
		const base: number[] = [];
		const acc: THREE.Vector3[] = [];
		for (const r of rings) {
			base.push(this.n);
			for (let j = 0; j < sides; j++) {
				this.vert(
					r.pts[j],
					Z_,
					r.bones,
					r.w,
					r.slot,
					r.pc ? r.pc[j] : r.pts[j],
					r.aux ?? A0,
				);
				acc.push(V());
			}
		}
		const first = base[0];
		const fn = V();
		const e1 = V();
		const e2 = V();
		const cen = V();
		const face = (a: number, b: number, c: number, out: THREE.Vector3) => {
			const pa = this.point(a);
			const pb = this.point(b);
			const pc = this.point(c);
			fn.crossVectors(e1.subVectors(pb, pa), e2.subVectors(pc, pa));
			cen.copy(pa).add(pb).add(pc).divideScalar(3);
			if (fn.dot(cen.sub(out)) < 0) {
				this.I.push(a, c, b);
				fn.negate();
			} else this.I.push(a, b, c);
			for (const v of [a, b, c]) acc[v - first].add(fn);
		};
		for (let i = 0; i + 1 < rings.length; i++) {
			if (rings[i + 1].seam) continue;
			const mid = rings[i].c
				.clone()
				.add(rings[i + 1].c)
				.multiplyScalar(0.5);
			for (let j = 0; j < sides; j++) {
				const j1 = (j + 1) % sides;
				face(base[i] + j, base[i] + j1, base[i + 1] + j1, mid);
				face(base[i] + j, base[i + 1] + j1, base[i + 1] + j, mid);
			}
		}
		const cap = (ri: number, pole: THREE.Vector3, inside: THREE.Vector3) => {
			const r = rings[ri];
			const ci = this.vert(pole, Z_, r.bones, r.w, r.slot, pole, r.aux ?? A0);
			acc.push(V());
			for (let j = 0; j < sides; j++)
				face(base[ri] + j, base[ri] + ((j + 1) % sides), ci, inside);
		};
		if (o.capStart) cap(0, o.capStart, rings[1].c);
		if (o.capEnd) cap(rings.length - 1, o.capEnd, rings[rings.length - 2].c);
		// A seam's duplicates share their normals, so a colour edge does not crease the shading.
		for (let i = 1; i < rings.length; i++)
			if (rings[i].seam)
				for (let j = 0; j < sides; j++) {
					const a = acc[base[i - 1] - first + j];
					const b = acc[base[i] - first + j];
					const s = a.clone().add(b);
					a.copy(s);
					b.copy(s);
				}
		for (let v = 0; v < acc.length; v++) {
			const nrm = acc[v].lengthSq() > 1e-20 ? acc[v].normalize() : Y_;
			this.N[(first + v) * 3] = nrm.x;
			this.N[(first + v) * 3 + 1] = nrm.y;
			this.N[(first + v) * 3 + 2] = nrm.z;
		}
	}

	/** A triangle facing the way its vertices' normals do. */
	orient(a: number, b: number, c: number): void {
		const nv = (i: number) =>
			V(this.N[i * 3], this.N[i * 3 + 1], this.N[i * 3 + 2]);
		const f = V().crossVectors(
			this.point(b).sub(this.point(a)),
			this.point(c).sub(this.point(a)),
		);
		if (f.dot(nv(a).add(nv(b)).add(nv(c))) < 0) this.I.push(a, c, b);
		else this.I.push(a, b, c);
	}

	build(): THREE.BufferGeometry {
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
		g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
		g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.SI, 4));
		g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.SW, 4));
		g.setAttribute('slot', new THREE.Float32BufferAttribute(this.SL, 1));
		g.setAttribute('pc', new THREE.Float32BufferAttribute(this.PC, 3));
		g.setAttribute('aux', new THREE.Float32BufferAttribute(this.AX, 3));
		g.setIndex(
			this.n > 65535
				? new THREE.Uint32BufferAttribute(this.I, 1)
				: new THREE.Uint16BufferAttribute(this.I, 1),
		);
		g.boundingSphere = new THREE.Sphere(V(0.1, 0.9, 0), 1.6);
		return g;
	}
}
