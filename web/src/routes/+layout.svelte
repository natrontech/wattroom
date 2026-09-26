<script lang="ts">
	// The one layout both halves share: the app's shell lives in (app), the
	// prerendered public pages in (site) (ADR-0061). Only what both need goes
	// here — this renders at build time, so nothing in it may touch the browser.
	import '../app.css';
	import '@fontsource/barlow/400.css';
	import '@fontsource/barlow/600.css';
	import '@fontsource/chakra-petch/500.css';
	import '@fontsource/chakra-petch/700.css';
	import { browser } from '$app/environment';

	let { children } = $props();

	// app.html's held frame (#2845) stood in until the bundle drew; every
	// page holds its own from here — the shell its hold, an unknown path the
	// error page — so it goes the moment any of them mounts. A prerendered
	// page never showed it (app.html hides it under [data-site]).
	if (browser) document.getElementById('boot')?.remove();
</script>

{@render children()}
