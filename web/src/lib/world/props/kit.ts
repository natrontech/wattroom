import * as THREE from 'three';
import * as P from '../props';
import type { PropColors } from '../styles';

/**
 * What a prop needs from the ground (#3076, #3219), read off its own model:
 * where it touches — the bounding box of its vertices near its lowest point —
 * how tall it stands, and how much of it is plinth, made to sit below.
 */

export const PROP_KINDS = [
	'house',
	'church',
	'barn',
	'hut',
	'rock',
	'cow',
	'spruce',
	'broadleaf',
] as const;
export type PropKind = (typeof PROP_KINDS)[number];

export type KitSpec = {
	/** The contact box's half width (x) and half depth (z), and its centre, in the model's frame. */
	hw: number;
	hd: number;
	cx: number;
	cz: number;
	height: number;
	plinth: number;
};

const MODELS: Record<PropKind, (c: PropColors) => THREE.BufferGeometry> = {
	house: P.house,
	church: P.church,
	barn: P.barn,
	hut: P.hut,
	rock: P.rock,
	cow: P.cow,
	spruce: P.spruce,
	broadleaf: P.broadleaf,
};

/** Vertices this near the lowest point are where a model meets the ground. */
const CONTACT_M = 0.5;

function specOf(g: THREE.BufferGeometry): KitSpec {
	const pos = g.attributes.position;
	let low = Infinity;
	let high = -Infinity;
	for (let i = 0; i < pos.count; i++) {
		low = Math.min(low, pos.getY(i));
		high = Math.max(high, pos.getY(i));
	}
	const box = new THREE.Box3();
	const v = new THREE.Vector3();
	for (let i = 0; i < pos.count; i++)
		if (pos.getY(i) <= low + CONTACT_M)
			box.expandByPoint(v.fromBufferAttribute(pos, i));
	return {
		hw: (box.max.x - box.min.x) / 2,
		hd: (box.max.z - box.min.z) / 2,
		cx: (box.max.x + box.min.x) / 2,
		cz: (box.max.z + box.min.z) / 2,
		height: high,
		plinth: Math.max(0, -low),
	};
}

// Colour is no part of a shape: any will do.
const ANY = new Proxy({}, { get: () => 'white' }) as PropColors;
let specs: Record<PropKind, KitSpec> | null = null;

export function kitSpec(kind: PropKind): KitSpec {
	specs ??= Object.fromEntries(
		PROP_KINDS.map((k) => {
			const g = MODELS[k](ANY);
			const s = specOf(g);
			g.dispose();
			return [k, s];
		}),
	) as Record<PropKind, KitSpec>;
	return specs[kind];
}
