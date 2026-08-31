<script lang="ts">
	import { page } from '$app/state';

	// errors.md: what went wrong, why, what to do. 404 gets its own copy;
	// everything else is a 500-shaped surprise with a reload as first aid.
	const notFound = $derived(page.status === 404);
</script>

<svelte:head>
	<title>{page.status} — WattRoom</title>
</svelte:head>

<main class="relative grid min-h-dvh place-items-center overflow-hidden px-6">
	<div
		class="bg-gridlines pointer-events-none absolute inset-x-0 top-0 h-[45dvh] opacity-40"
		aria-hidden="true"
	></div>

	<div class="relative max-w-md pb-16 text-center">
		<p class="font-display text-neon text-8xl font-bold tracking-tight">
			{page.status}
		</p>
		{#if notFound}
			<h1 class="font-display mt-4 text-xl font-bold">
				Off the front — there's no page here.
			</h1>
			<p class="text-muted mt-2 text-sm">
				The link may be stale, or what it pointed at is gone.
			</p>
			<div class="mt-6">
				<a href="/home" class="btn btn-primary">Back to home</a>
			</div>
		{:else}
			<h1 class="font-display mt-4 text-xl font-bold">We dropped the chain.</h1>
			<p class="text-muted mt-2 text-sm">
				Something broke on our side — your setup is fine. A reload usually fixes
				it; if it keeps happening, send us feedback so we can chase it.
			</p>
			<div class="mt-6 flex justify-center gap-3">
				<button class="btn btn-primary" onclick={() => location.reload()}>
					Reload
				</button>
				<a href="/home" class="btn btn-secondary">Back to home</a>
			</div>
		{/if}
		{#if page.error?.message && page.error.message !== 'Not Found'}
			<p class="text-muted/60 mt-6 font-mono text-xs">{page.error.message}</p>
		{/if}
	</div>
</main>
