// Name tags over riders (#3086, ADR-0073): small dark pills with a neon
// hairline and ink text, over the two riders nearest you and anyone speaking
// — never over you, never glowing. Tags that would overlap merge into one;
// each keeps to the keep-clear corridor's upper half, clear of the panels
// beside it and of the road ahead below.
import * as THREE from 'three';
import { CORRIDOR } from '$lib/session/docks';
import { tag } from './family';
import { CHEVRON_Y, THUMB_Y } from './crew';
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
/** Each end's padding, as a share of the pill's height: the target's small pill (v2-ride). */
const PAD = 0.6;
/** A character's width as a share of the text's height, where no canvas can measure: Barlow at its widest. */
const CHAR_W = 0.6;
/** The words' weight: medium, as the target's names are. */
const WEIGHT = 500;
/** Where a tag's foot sits: just clear of a chevron's height, so no chevron abreast hides under it, or over a cheer's thumb while it shows. */
const footOf = (r: SimRider) =>
	r.cheer && r.cheer.thumb > 0 ? THUMB_Y + 0.2 : CHEVRON_Y + 0.12;

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

let measurer:
	| OffscreenCanvasRenderingContext2D
	| CanvasRenderingContext2D
	| null
	| undefined;
/** The words' width in ems, as the tag's font draws them. */
function ems(text: string) {
	measurer ??=
		typeof OffscreenCanvas === 'function'
			? new OffscreenCanvas(1, 1).getContext('2d')
			: document.createElement('canvas').getContext('2d');
	if (!measurer) return CHAR_W * text.length;
	measurer.font = `${WEIGHT} 100px ${FONT}`;
	return measurer.measureText(text).width / 100;
}

/** A pill's width as a share of the frame's height: its words, and the padding at each end. */
const spanOf = (text: string) => TEXT_H * ems(text) + 2 * PAD * PILL_H;
/** A pill's width as a share of the frame's width, for a frame `aspect` wide to 1 tall. */
const widthOf = (text: string, aspect: number) => spanOf(text) / aspect;

/** A tag kept to the corridor's upper half: no panel beside it, no road ahead under it. */
function keep(t: Laid, aspect: number): Laid {
	const half = widthOf(t.text, aspect) / 2;
	const middle = (CORRIDOR.y0 + CORRIDOR.y1) / 2;
	return {
		...t,
		x: Math.min(Math.max(t.x, CORRIDOR.x0 + half), CORRIDOR.x1 - half),
		y: Math.min(Math.max(t.y, CORRIDOR.y0 + PILL_H / 2), middle - PILL_H / 2),
	};
}

/** The tags as the frame shows them: kept to the corridor's upper half, and any that would overlap merged into one, left to right. */
export function lay(tags: readonly Laid[], aspect: number): Laid[] {
	const out: Laid[] = [];
	for (const t of tags.map((t) => keep(t, aspect)).sort((a, b) => a.x - b.x)) {
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
		else out.push(t);
	}
	return out.map((t) => keep(t, aspect));
}

/** The pill as a texture: dark, the kit's faint neon hairline, ink words; a speaking rider's hairline is the ink at twice the width. */
function pill(text: string, speaking: boolean, style: Style) {
	const h = 60;
	const w = Math.round((h * spanOf(text)) / PILL_H);
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
			x.globalAlpha = speaking ? 1 : 0.38;
			x.stroke();
			x.globalAlpha = 1;
			x.fillStyle = style.tag.ink;
			x.font = `${WEIGHT} ${Math.round(h * (TEXT_H / PILL_H))}px ${FONT}`;
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
								.setY(at(r).y + footOf(r))
								.project(camera);
							if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return [];
							deep.push(v.z);
							return [
								{
									text: textOf(r),
									speaking: !!r.speaking,
									x: (v.x + 1) / 2,
									y: (1 - v.y) / 2 - PILL_H / 2,
								},
							];
						}),
						camera.aspect,
					);
			const z = deep.length ? Math.min(...deep) : 0.5;
			const shown = new Set(laid.map((t) => `${t.text}|${t.speaking}`));
			for (const [key, s] of drawn)
				if (!shown.has(key)) {
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
