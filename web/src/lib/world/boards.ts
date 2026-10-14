import * as THREE from 'three';
import type { Route } from '$lib/road/route';
import {
	ARCH_BANNER,
	ARCH_PAINT,
	ARCH_POSTS,
	paintArch,
	paintedTexture,
	paintSign,
	type Painting,
} from './furniture';
import { yOf } from './geometry';
import type { Arch, Sign } from './setpieces';
import type { Style } from './styles';

/**
 * The ride's signs and KOM arches as the GPU draws them (#3642): every post,
 * leg and frame one BatchedMesh tinted per instance, every painted face a
 * slot of an atlas page drawn as one more. A tile's boards come and go with
 * its props (stage.ts).
 */

/** A face's slot: each face is painted at its own size, stretched into one, and stretched back onto its board. */
const SLOT_W = 512;
const SLOT_H = 256;
const COLS = 4;
const ROWS = 4;
/** UV inset, in pixels, so a page's far mips blend little of a neighbour's face. */
const INSET = 4;
/** Frames the batch makes room for at first; it grows by half when it runs out. */
const ROOM = 128;
/** A face stands this far off its frame, so the two never fight for depth. */
const LIFT = 0.01;

type Paint = (x: NonNullable<Painting['x']>) => void;
type Page = {
	mesh: THREE.BatchedMesh;
	tex: THREE.Texture;
	x: NonNullable<Painting['x']> | null;
	/** Each slot's quad, by slot. */
	quads: number[];
	free: number[];
};
type Member =
	{ mesh: THREE.BatchedMesh; id: number } | { page: Page; slot: number };

export function batchBoards(route: Route, style: Style) {
	const root = new THREE.Group();
	const shapes = [
		new THREE.BoxGeometry(),
		new THREE.CylinderGeometry(1, 1, 1, 6),
	];
	const frames = new THREE.BatchedMesh(
		ROOM,
		shapes.reduce((n, g) => n + g.attributes.position.count, 0),
		shapes.reduce((n, g) => n + g.index!.count, 0),
		new THREE.MeshLambertMaterial(),
	);
	frames.frustumCulled = false; // its instances are culled one by one
	frames.sortObjects = false;
	const [box, post] = shapes.map((g) => {
		const id = frames.addGeometry(g);
		g.dispose();
		return id;
	});
	root.add(frames);
	const pages: Page[] = [];

	function newPage(): Page {
		let x: Page['x'] = null;
		const tex = paintedTexture(COLS * SLOT_W, ROWS * SLOT_H, (c) => (x = c));
		const mesh = new THREE.BatchedMesh(
			2 * COLS * ROWS,
			4 * COLS * ROWS,
			6 * COLS * ROWS,
			new THREE.MeshLambertMaterial({ map: tex }),
		);
		mesh.frustumCulled = false;
		mesh.sortObjects = false;
		const quads = Array.from({ length: COLS * ROWS }, (_, slot) => {
			const q = new THREE.PlaneGeometry();
			const [c, r] = [slot % COLS, Math.floor(slot / COLS)];
			const u0 = (c * SLOT_W + INSET) / (COLS * SLOT_W);
			const u1 = ((c + 1) * SLOT_W - INSET) / (COLS * SLOT_W);
			// A canvas texture is flipped: v = 1 is the canvas's top row.
			const v1 = 1 - (r * SLOT_H + INSET) / (ROWS * SLOT_H);
			const v0 = 1 - ((r + 1) * SLOT_H - INSET) / (ROWS * SLOT_H);
			const uv = q.attributes.uv;
			for (let i = 0; i < uv.count; i++)
				uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
			const id = mesh.addGeometry(q);
			q.dispose();
			return id;
		});
		const page = {
			mesh,
			tex,
			x,
			quads,
			free: quads.map((_, i) => i).reverse(),
		};
		pages.push(page);
		root.add(mesh);
		return page;
	}

	const base = new THREE.Matrix4();
	const part = new THREE.Matrix4();
	const own = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const up = new THREE.Vector3(0, 1, 0);
	const at = new THREE.Vector3();
	const size = new THREE.Vector3();
	const tint = new THREE.Color();
	const place = (x: number, y: number, z: number, turn: number) =>
		base.compose(
			at.set(x, y, z),
			q.setFromAxisAngle(up, turn),
			size.setScalar(1),
		);
	/** The matrix of a part at `p`, turned `turn`, sized `s`, in the board's frame. */
	const local = (p: readonly number[], turn: number, s: readonly number[]) =>
		part.multiplyMatrices(
			base,
			own.compose(
				at.set(p[0], p[1], p[2]),
				q.setFromAxisAngle(up, turn),
				size.set(s[0], s[1], s[2]),
			),
		);

	function frame(
		out: Member[],
		geometry: number,
		p: readonly number[],
		s: readonly number[],
		color: string,
	) {
		if (frames.instanceCount >= frames.maxInstanceCount)
			frames.setInstanceCount(Math.ceil(frames.maxInstanceCount * 1.5));
		const id = frames.addInstance(geometry);
		frames.setMatrixAt(id, local(p, 0, s));
		frames.setColorAt(id, tint.set(color));
		out.push({ mesh: frames, id });
	}

	/** Paints a face into a free slot and stands it at each of `sides`: centre and turn. */
	function face(
		out: Member[],
		[W, H]: readonly [number, number],
		paint: Paint,
		sides: [p: readonly number[], turn: number][],
		w: number,
		h: number,
	) {
		const page = pages.find((p) => p.free.length > 0) ?? newPage();
		const slot = page.free.pop()!;
		if (page.x) {
			const x = page.x;
			x.save();
			x.translate((slot % COLS) * SLOT_W, Math.floor(slot / COLS) * SLOT_H);
			x.scale(SLOT_W / W, SLOT_H / H);
			paint(x);
			x.restore();
			page.tex.needsUpdate = true;
		}
		out.push({ page, slot });
		for (const [p, turn] of sides) {
			const id = page.mesh.addInstance(page.quads[slot]);
			page.mesh.setMatrixAt(id, local(p, turn, [w, h, 1]));
			out.push({ mesh: page.mesh, id });
		}
	}

	const tiles = new Map<string, Member[]>();
	return {
		/** Every frame and atlas page: one group for the stage to hold. */
		root,
		/** Stands a tile's signs and arches. */
		add(id: string, signs: readonly Sign[], arches: readonly Arch[]) {
			const out: Member[] = [];
			for (const s of signs) {
				const look = style.signs[s.look];
				place(
					s.x,
					yOf(route, s.y) - 0.1,
					s.z,
					Math.atan2(s.turn[1], s.turn[0]),
				);
				const legH = s.look === 'hairpin' ? 1.0 : 1.4;
				const y = legH + s.h / 2;
				frame(out, box, [0, y, 0], [s.w, s.h, 0.06], look.post);
				const leg = legH + s.h * 0.6;
				for (const x of s.look === 'hairpin' ? [0] : [-s.w * 0.38, s.w * 0.38])
					frame(out, post, [x, leg / 2, -0.05], [0.04, leg, 0.04], look.post);
				const W = 512;
				const H = Math.round((W * s.h) / s.w);
				face(
					out,
					[W, H],
					(x) => paintSign(x, s, look, W, H),
					[[[0, y, 0.03 + LIFT], 0]],
					s.w,
					s.h,
				);
			}
			for (const a of arches) {
				place(
					a.x,
					yOf(route, a.y) + 0.1,
					a.z,
					Math.atan2(a.turn[1], a.turn[0]) + Math.PI,
				);
				for (const [p, s] of [...ARCH_POSTS, ARCH_BANNER])
					frame(out, box, p, s, style.arch.chrome);
				const [[bx, by], [bw, bh, bd]] = ARCH_BANNER;
				const off = bd / 2 + LIFT;
				face(
					out,
					ARCH_PAINT,
					(x) => paintArch(x, a.label, style),
					[
						[[bx, by, off], 0],
						[[bx, by, -off], Math.PI],
					],
					bw,
					bh,
				);
			}
			if (out.length > 0) tiles.set(id, out);
		},
		/** Lets a tile's boards go: their instances' room and their slots are free for the next. */
		drop(id: string) {
			for (const m of tiles.get(id) ?? [])
				if ('page' in m) m.page.free.push(m.slot);
				else m.mesh.deleteInstance(m.id);
			tiles.delete(id);
		},
	};
}
