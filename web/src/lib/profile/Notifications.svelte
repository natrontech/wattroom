<script lang="ts">
	// The Notifications switch on the profile page (#202, ADR-0042). Split
	// out of the page for size.
	import { shellVersion } from '$lib/desktop';
	import { notify } from '$lib/notify.svelte';
</script>

<!-- Notifications (#202, ADR-0042): chat, arrivals, a session starting —
     when this window is hidden or behind another app. A browser needs
     the gesture for the permission, so this is the switch; the desktop
     app is on unless switched off here. -->
{#if notify.supported}
	<section class="border-muted/15 mt-3 rounded-lg border p-6">
		<h2 class="font-display font-bold">Notifications</h2>
		<div class="mt-3 flex flex-wrap items-center gap-3">
			<p class="text-muted min-w-56 flex-1 text-sm leading-relaxed">
				{#if notify.enabled}
					On. A message, someone arriving, a session starting or a poke reaches
					you while this window is hidden or behind another app.
				{:else if shellVersion()}
					Off. Nothing reaches you while the app is behind another window.
				{:else}
					Off. Turn it on and this browser asks once for permission.
				{/if}
			</p>
			{#if notify.enabled}
				<button class="btn btn-secondary" onclick={() => notify.disable()}
					>Turn off</button
				>
			{:else}
				<button class="btn btn-primary" onclick={() => void notify.enable()}
					>Turn on notifications</button
				>
			{/if}
		</div>
	</section>
{/if}
