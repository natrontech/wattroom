/**
 * Whether the rider asked the OS for reduced motion (ADR-0005: the app honours
 * it). CSS transitions are stilled once in app.css; this is for motion driven
 * from script — a Svelte transition, an interval — which CSS cannot reach.
 * False where there is no window to ask.
 */
export const reducedMotion = (): boolean =>
	typeof matchMedia === 'function' &&
	matchMedia('(prefers-reduced-motion: reduce)').matches;
