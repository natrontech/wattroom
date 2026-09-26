// The app is a SPA: no SSR, no prerender — the Go server serves the build's
// fallback page for every route in here (ADR-0061 prerenders (site) instead).
export const ssr = false;
export const prerender = false;
