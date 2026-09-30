/// <reference lib="webworker" />
// Builds the chunks the page asks for, in the order it asks, off the main
// thread (#3074). It holds no salt of its own: the served road's keying
// arrives in `init` (#3225), and every chunk goes back as a transferred
// buffer the moment it is built. A streamed ride's ground comes the same
// way (#3606): its roads and salt in `ground`, each chunk's grid back as it
// is built.
import { buildChunk } from './chunk';
import { indexStroke, type StrokeIndex } from './stroke-index';
import type { ToWorker } from './builder';
import type { FromGroundWorker, ToGroundWorker } from './grids';
import type { Keying } from '../place/region';
import { landUse } from '../land';
import { makeGround } from '../terrain/ground';
import { gridOf, placeLevel } from '../terrain-mesh';

let keying: Keying | null = null;
let index: StrokeIndex | null = null;
// ponytail: the ground caches every lattice point it is asked, for the ride; a long one grows it by tens of MB.
let place: {
	ground: ReturnType<typeof makeGround>;
	land: ReturnType<typeof landUse>;
	level: ReturnType<typeof placeLevel>;
} | null = null;

self.onmessage = (e: MessageEvent<ToWorker | ToGroundWorker>) => {
	const m = e.data;
	if (m.type === 'ground') {
		const ground = makeGround(m.roads, { salt: m.salt });
		place = {
			ground,
			land: landUse(ground.noise),
			level: placeLevel(ground.lines),
		};
		return;
	}
	if (m.type === 'grids') {
		if (!place) return;
		for (const chunk of m.chunks) {
			const grid = gridOf(place.ground, place.land, place.level, ...chunk);
			const reply: FromGroundWorker = { type: 'grid', chunk, grid };
			self.postMessage(
				reply,
				grid
					? [
							grid.h.buffer,
							grid.biome.buffer,
							grid.shade.buffer,
							grid.forest.buffer,
						]
					: [],
			);
		}
		return;
	}
	if (m.type === 'init') {
		keying = m.keying;
		index = indexStroke(m.keying.stroke);
		return;
	}
	if (!keying || !index) return;
	for (const chunk of m.chunks) {
		const words = buildChunk(chunk, keying, index);
		self.postMessage({ type: 'chunk', chunk, words }, [words.buffer]);
	}
};
