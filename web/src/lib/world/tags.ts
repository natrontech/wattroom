// Name tags over riders (#3086, ADR-0073): small dark pills with a hairline
// and ink text, over the two riders nearest you and anyone speaking — never
// over you, never neon, never glowing. Tags that would overlap merge into
// one; none sits in the lower half of the keep-clear corridor, where the road
// ahead is.
import * as THREE from 'three';
import { CORRIDOR } from '$lib/session/docks';
import { tag } from './family';
import { FONT, paintedTexture } from './furniture';
import type { SimRider } from './sim';
import type { Style } from './styles';

/** How many of the riders nearest you carry a tag (docs/design/TARGETS.md). */
const NEAREST = 2;
/**
 * A pill's height, and its text's, as shares of a 900 px frame: 20 px of text
 * is above the 16 arcmin a label needs at a 14-inch laptop's 0.8 m (#3086).
 */
export const PILL_H = 30 / 900;
export const TEXT_H = 20 / 900;
/** A character's width as a share of the text's height: Barlow at its widest. */
const CHAR_W = 0.6;
/** Over the helmet, clear of the coach's chevron and a cheer's thumb. */
const TAG_Y = 2.6;

/** A tag as the frame lays it: its words, and its centre as shares of the frame, from the top left. */
export type Laid = { text: string; speaking: boolean; x: number; y: number };

/** Who carries a tag: the riders nearest you by road and anyone speaking, never you. */
export function carriers(riders: readonly SimRider[]): SimRider[] {
	const me = riders.find((r) => r.you);
	const others = riders.filter((r) => !r.you && (r.alpha ?? 1) > 0);
	const near = me
		? [...others]
				.sort((a, b) => Math.abs(a.d - me.d) - Math.abs(b.d - me.d))
				.slice(0, NEAREST)
		: [];
	return others.filter((r) => near.includes(r) || r.speaking);
}

/** A rider's words on their tag: their name, and their level where known. */
export const textOf = (r: SimRider) =>
	r.level ? `${r.name} · Lv ${r.level}` : r.name;

/** A pill's width as a share of the frame's width, for a frame `aspect` wide to 1 tall. */
const widthOf = (text: string, aspect: number) =>
	(TEXT_H * CHAR_W * text.length + PILL_H) / aspect;

/**
 * The tags as the frame shows them: any that would overlap merged into one,
 * left to right, and any in the corridor's lower half lifted to its middle.
 */
export function lay(tags: readonly Laid[], aspect: number): Laid[] {
	const out: Laid[] = [];
	for (const t of [...tags].sort((a, b) => a.x - b.x)) {
		const prev = out.at(-1);
		const overlaps =
			prev &&
			Math.abs(prev.x - t.x) <
				(widthOf(prev.text, aspect) + widthOf(t.text, aspect)) / 2 &&
			Math.abs(prev.y - t.y) < PILL_H;
		if (prev && overlaps)
			out[out.length - 1] = {
				text: `${prev.text} / ${t.text}`,
				speaking: prev.speaking || t.speaking,
				x: (prev.x + t.x) / 2,
				y: Math.min(prev.y, t.y),
			};
		else out.push({ ...t });
	}
	const middle = (CORRIDOR.y0 + CORRIDOR.y1) / 2;
	for (const t of out)
		if (t.x > CORRIDOR.x0 && t.x < CORRIDOR.x1 && t.y + PILL_H / 2 > middle)
			t.y = middle - PILL_H / 2;
	return out;
}

/** The pill as a texture: dark, a hairline, ink words; a speaking rider's hairline is the ink at twice the width. */
function pill(text: string, speaking: boolean, style: Style) {
	const h = 60;
	const w = Math.round(h * ((TEXT_H * CHAR_W * text.length + PILL_H) / PILL_H));
	return {
		w,
		h,
		map: paintedTexture(w, h, (x) => {
			x.fillStyle = style.tag.bg;
			x.strokeStyle = speaking ? style.tag.ink : style.tag.line;
			x.lineWidth = speaking ? 4 : 2;
			x.beginPath();
			x.roundRect(2, 2, w - 4, h - 4, h / 2 - 2);
			x.fill();
			x.stroke();
			x.fillStyle = style.tag.ink;
			x.font = `600 ${Math.round(h * (TEXT_H / PILL_H))}px ${FONT}`;
			x.textAlign = 'center';
			x.textBaseline = 'middle';
			x.fillText(text, w / 2, h / 2 + 1);
		}),
	};
}

export function makeTags(style: Style) {
	const group = new THREE.Group();
	const drawn = new Map<string, THREE.Sprite>();
	const v = new THREE.Vector3();
	return {
		group,
		/** This frame's tags, from the riders as placed and the camera that looks at them. */
		update(
			riders: readonly SimRider[],
			at: (r: SimRider) => THREE.Vector3,
			camera: THREE.PerspectiveCamera,
			overview: boolean,
		) {
			camera.updateMatrixWorld();
			const deep: number[] = [];
			const laid = overview
				? []
				: lay(
						carriers(riders).flatMap((r) => {
							v.copy(at(r))
								.setY(at(r).y + TAG_Y)
								.project(camera);
							if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return [];
							deep.push(v.z);
							return [
								{
									text: textOf(r),
									speaking: !!r.speaking,
									x: (v.x + 1) / 2,
									y: (1 - v.y) / 2,
								},
							];
						}),
						camera.aspect,
					);
			const z = deep.length ? Math.min(...deep) : 0.5;
			const keep = new Set(laid.map((t) => `${t.text}|${t.speaking}`));
			for (const [key, s] of drawn)
				if (!keep.has(key)) {
					group.remove(s);
					s.material.map?.dispose();
					s.material.dispose();
					drawn.delete(key);
				}
			const tall = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
			for (const t of laid) {
				const key = `${t.text}|${t.speaking}`;
				let s = drawn.get(key);
				if (!s) {
					const p = pill(t.text, t.speaking, style);
					s = new THREE.Sprite(
						new THREE.SpriteMaterial({
							map: p.map,
							sizeAttenuation: false,
							depthTest: false,
							transparent: true,
						}),
					);
					s.scale.set((tall * PILL_H * p.w) / p.h, tall * PILL_H, 1);
					s.renderOrder = 10;
					s.userData.text = t.text;
					s.userData.speaking = t.speaking;
					group.add(tag('marks', s, 'name-tag'));
					drawn.set(key, s);
				}
				s.position.set(t.x * 2 - 1, 1 - t.y * 2, z).unproject(camera);
			}
		},
	};
}
export type Tags = ReturnType<typeof makeTags>;
