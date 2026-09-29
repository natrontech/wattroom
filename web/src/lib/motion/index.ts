/**
 * Whether the rider asked the OS for reduced motion (ADR-0005, ADR-0079).
 * `prefersReducedMotion` is Svelte's reactive answer; the tokens and the
 * transitions that read it are `./tokens` and `./transitions`.
 */
export { prefersReducedMotion } from 'svelte/motion';

/**
 * The one-shot read, kept as an alias until its callers move to
 * `prefersReducedMotion`. False where there is no window to ask.
 */
export const reducedMotion = (): boolean =>
	typeof matchMedia === 'function' &&
	matchMedia('(prefers-reduced-motion: reduce)').matches;
