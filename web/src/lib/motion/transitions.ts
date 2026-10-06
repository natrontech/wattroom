import { flip } from 'svelte/animate';
import { prefersReducedMotion } from 'svelte/motion';
import { fly, slide } from 'svelte/transition';
import { bezier, DUR, EASE } from './tokens';

/**
 * The app's Svelte transitions, on the motion tokens (ADR-0079). Svelte runs
 * them on the Web Animations API, where app.css's reduced-motion rule never
 * reaches, so each one asks `prefersReducedMotion` itself: for a rider who
 * asked the OS for stillness, a thing is simply there.
 */

const arrive = bezier(EASE.arrive);
const leave = bezier(EASE.leave);
const moving = bezier(EASE.move);
const still = () => prefersReducedMotion.current;

/** Where a thing comes from or goes to: an offset in px, or a slide along an axis. */
type Path = { x?: number; y?: number } | { axis: 'x' | 'y' };

const travel = (
	node: Element,
	path: Path | false,
	duration: number,
	easing: (t: number) => number,
) => {
	if (!path || still()) return { duration: 0 };
	return 'axis' in path
		? slide(node, { axis: path.axis, duration, easing })
		: fly(node, { ...path, duration, easing });
};

/** Something arriving, over `--dur-base` on `--ease-arrive`. `false` arrives without motion. */
export const enter = (node: Element, path: Path | false = {}) =>
	travel(node, path, DUR.base, arrive);

/** Something leaving, quicker than it came: `--dur-quick` on `--ease-leave`. */
export const exit = (node: Element, path: Path | false = {}) =>
	travel(node, path, DUR.quick, leave);

/** `animate:reorder` — a thing changing place in a list, on `--ease-move`. */
export const reorder = (
	node: Element,
	fromTo: { from: DOMRect; to: DOMRect },
) => flip(node, fromTo, { duration: still() ? 0 : DUR.base, easing: moving });

/**
 * One pulse on a value that changed — the gear after a shift (ADR-0084).
 * Once, never looping, and nothing for a rider who asked for stillness.
 */
export function pulse(node: Element | undefined) {
	if (!node || still()) return;
	node.animate?.([{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }], {
		duration: DUR.reveal,
		easing: `cubic-bezier(${EASE.arrive.join(',')})`,
	});
}
