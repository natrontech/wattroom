<script lang="ts">
	// The Notifications section of Settings (#202, ADR-0042; #1330). Four
	// things a browser can say and the section says each of them: on, off,
	// blocked — the rider once pressed Block and no prompt will ever show
	// again — and not supported at all, as on iOS Safari in a tab.
	import { shellVersion } from '$lib/desktop';
	import { notify } from '$lib/notify.svelte';

	let blocked = $state(notify.permission === 'denied');
	async function turnOn() {
		blocked = (await notify.enable()) === 'denied';
	}
</script>

<section class="panel mt-8 p-6">
	<h2 class="font-display font-bold">Notifications</h2>
	<div class="mt-3 flex flex-wrap items-center gap-3">
		<p class="text-muted min-w-56 flex-1 text-sm leading-relaxed">
			{#if !notify.supported}
				This browser cannot show notifications. Add WattRoom to your home
				screen, or use the desktop app, and they work.
			{:else if notify.enabled}
				On. A message, someone arriving, a session starting or a poke reaches
				you while this window is hidden or behind another app.
			{:else if blocked}
				Blocked by this browser: it will not ask again. Allow notifications for
				this site in the browser's site settings, then turn them on here.
			{:else if shellVersion()}
				Off. Nothing reaches you while the app is behind another window.
			{:else}
				Off. Turn it on and this browser asks once for permission.
			{/if}
		</p>
		{#if notify.supported && notify.enabled}
			<button class="btn btn-secondary" onclick={() => notify.disable()}
				>Turn off</button
			>
		{:else if notify.supported && !blocked}
			<button class="btn btn-primary" onclick={() => void turnOn()}
				>Turn on notifications</button
			>
		{/if}
	</div>
</section>
