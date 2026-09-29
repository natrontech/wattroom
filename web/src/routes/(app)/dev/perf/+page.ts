import { devOnly } from '$lib/dev-only';

// `+page@.svelte` resets past the app and dev layouts — their nav carries a
// backdrop blur that would sit in every measurement — so their load and SPA
// settings do not reach this page and are restated here.
export const ssr = false;
export const prerender = false;
export const load = devOnly;
