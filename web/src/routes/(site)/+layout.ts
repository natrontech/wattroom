// The public pages are HTML at build time (ADR-0061): a crawler that runs no
// script, a link preview and a slow phone all get the words, not a boot frame.
export const prerender = true;
