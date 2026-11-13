import { devOnly } from '#lib/dev-only.ts';

// `+page@.svelte` resets past the app and dev layouts, so their load and SPA
// settings are restated here. A production build answers 404: the route lab
// exists on a dev machine only.
export const ssr = false;
export const prerender = false;
export const load = devOnly;
