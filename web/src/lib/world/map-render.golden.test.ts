import { readFileSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { HOME_ROADS, homeRoute } from '#lib/ride/home-roads.ts';
import { MAP_BOUNDS, MAP_NAME } from './designs';
import { MAP_MPP, mapData, renderLand, tokensOf } from './map-render';
import { routeOfRoad } from './road-route';
import { generate } from './world';

/**
 * The map as one picture (map-render.ts): wattalp-map.png, the land, and
 * wattalp-map.json, what MapOverview.svelte draws live over it. A change to
 * designs.ts or to the land moves both; rewrite them with
 * `UPDATE_MAP=1 nice -n 15 pnpm exec vitest run src/lib/world/map-render.golden.test.ts`
 * and commit both (.claude/skills/render-map). Without it this only checks
 * the two still describe today's MAP_BOUNDS.
 */
const png = new URL('./wattalp-map.png', import.meta.url);
const json = new URL('./wattalp-map.json', import.meta.url);

function chunk(type: string, data: Uint8Array) {
	const out = Buffer.alloc(12 + data.length);
	out.writeUInt32BE(data.length, 0);
	out.write(type, 4, 'ascii');
	Buffer.from(data).copy(out, 8);
	out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
	return out;
}

/**
 * RGB to 256 colours: median cut over a 5-bit histogram, the box split
 * first that holds the most pixels times its widest span, then a few rounds
 * of k-means so each colour sits where its pixels are.
 */
function quantize(rgb: Uint8Array): { index: Uint8Array; palette: Uint8Array } {
	const keyOf = (i: number) =>
		((rgb[i] >> 3) << 10) | ((rgb[i + 1] >> 3) << 5) | (rgb[i + 2] >> 3);
	const count = new Map<number, number>();
	for (let i = 0; i < rgb.length; i += 3) {
		const k = keyOf(i);
		count.set(k, (count.get(k) ?? 0) + 1);
	}
	const ch = (k: number, c: number) => ((k >> (10 - 5 * c)) & 31) * 8 + 4;
	const keys = [...count.keys()];
	const span = (b: number[]) => {
		let wide = 0;
		let axis = 0;
		for (let c = 0; c < 3; c++) {
			let lo = 255;
			let hi = 0;
			for (const k of b) {
				lo = Math.min(lo, ch(k, c));
				hi = Math.max(hi, ch(k, c));
			}
			if (hi - lo > wide) [wide, axis] = [hi - lo, c];
		}
		return { wide, axis };
	};
	const boxes: number[][] = [keys];
	while (boxes.length < 256) {
		let pick = -1;
		let most = 0;
		boxes.forEach((b, i) => {
			if (b.length < 2) return;
			const n = b.reduce((s, k) => s + count.get(k)!, 0);
			const score = n * span(b).wide;
			if (score > most) [most, pick] = [score, i];
		});
		if (pick < 0) break;
		const b = boxes[pick];
		const { axis } = span(b);
		b.sort((p, q) => ch(p, axis) - ch(q, axis));
		const total = b.reduce((s, k) => s + count.get(k)!, 0);
		let half = 0;
		let cut = 0;
		for (; cut < b.length - 2; cut++) {
			half += count.get(b[cut])!;
			if (half >= total / 2) break;
		}
		boxes.splice(pick, 1, b.slice(0, cut + 1), b.slice(cut + 1));
	}
	const mean = (b: number[]) => {
		const s = [0, 0, 0, 0];
		for (const k of b) {
			const n = count.get(k)!;
			for (let c = 0; c < 3; c++) s[c] += ch(k, c) * n;
			s[3] += n;
		}
		return [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
	};
	let centres = boxes.map(mean);
	const nearest = (k: number) => {
		let best = 0;
		let least = Infinity;
		const [r, g, b] = [ch(k, 0), ch(k, 1), ch(k, 2)];
		centres.forEach(([cr, cg, cb], i) => {
			const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
			if (d < least) [least, best] = [d, i];
		});
		return best;
	};
	for (let round = 0; round < 4; round++) {
		const groups: number[][] = centres.map(() => []);
		for (const k of keys) groups[nearest(k)].push(k);
		centres = groups.map((g, i) => (g.length ? mean(g) : centres[i]));
	}
	// The palette is the pixels' own mean in each colour, not the histogram's 5-bit one.
	const of = new Map<number, number>();
	for (const k of keys) of.set(k, nearest(k));
	const sum = new Float64Array(centres.length * 4);
	const index = new Uint8Array(rgb.length / 3);
	for (let i = 0, p = 0; i < rgb.length; i += 3, p++) {
		const b = of.get(keyOf(i))!;
		index[p] = b;
		sum[b * 4] += rgb[i];
		sum[b * 4 + 1] += rgb[i + 1];
		sum[b * 4 + 2] += rgb[i + 2];
		sum[b * 4 + 3]++;
	}
	const palette = new Uint8Array(centres.length * 3);
	for (let b = 0; b < centres.length; b++)
		for (let c = 0; c < 3; c++)
			palette[b * 3 + c] = Math.round(
				sum[b * 4 + 3] ? sum[b * 4 + c] / sum[b * 4 + 3] : centres[b][c],
			);
	return { index, palette };
}

/** A 256-colour PNG of an RGB picture. */
function encodePng(rgb: Uint8Array, w: number, h: number): Buffer {
	const { index, palette } = quantize(rgb);
	const raw = Buffer.alloc((w + 1) * h);
	for (let y = 0; y < h; y++)
		Buffer.from(index.subarray(y * w, (y + 1) * w)).copy(raw, y * (w + 1) + 1);
	const head = Buffer.alloc(13);
	head.writeUInt32BE(w, 0);
	head.writeUInt32BE(h, 4);
	head[8] = 8; // bits
	head[9] = 3; // indexed
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', head),
		chunk('PLTE', palette),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', new Uint8Array()),
	]);
}

describe(`the map of ${MAP_NAME}`, () => {
	it.runIf(process.env.UPDATE_MAP === '1')(
		'is drawn again from the land',
		async () => {
			const home = HOME_ROADS.find((r) => r.id === 'berne')!;
			const route = routeOfRoad((await homeRoute(home)).road);
			const world = generate(route);
			const css = readFileSync(
				new URL('../../app.css', import.meta.url),
				'utf8',
			);
			const land = renderLand(world, tokensOf(css));
			writeFileSync(png, encodePng(land.rgb, land.w, land.h));
			writeFileSync(
				json,
				`${JSON.stringify(mapData(world, route), null, '\t')}\n`,
			);
		},
		600_000,
	);

	it('is a picture of today’s map: its rectangle, its name, its size', () => {
		const data = JSON.parse(readFileSync(json, 'utf8'));
		expect(data.name).toBe(MAP_NAME);
		expect(data.bounds).toEqual(MAP_BOUNDS);
		expect(data.image.mpp).toBe(MAP_MPP);
		const head = readFileSync(png).subarray(16, 24);
		expect([head.readUInt32BE(0), head.readUInt32BE(4)]).toEqual([
			data.image.w,
			data.image.h,
		]);
		expect(data.image.w * MAP_MPP).toBe(MAP_BOUNDS.east - MAP_BOUNDS.west);
		expect(data.image.h * MAP_MPP).toBe(MAP_BOUNDS.north - MAP_BOUNDS.south);
	});
});
