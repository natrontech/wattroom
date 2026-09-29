/// <reference lib="webworker" />
// Builds the chunks the page asks for, in the order it asks, off the main
// thread (#3074). It holds no salt of its own: the served road's keying
// arrives in `init` (#3225), and every chunk goes back as a transferred
// buffer the moment it is built.
import { buildChunk } from './chunk';
import { indexStroke, type StrokeIndex } from './stroke-index';
import type { ToWorker } from './builder';
import type { Keying } from '../place/region';

let keying: Keying | null = null;
let index: StrokeIndex | null = null;

self.onmessage = (e: MessageEvent<ToWorker>) => {
	const m = e.data;
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
