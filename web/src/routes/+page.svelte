<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';

	let health = $state<string | null>(null);

	async function ping() {
		const res = await fetch('/api/healthz');
		health = res.ok ? await res.text() : `error ${res.status}`;
	}
</script>

<main
	class="bg-surface flex min-h-screen flex-col items-center justify-center gap-6 text-white"
>
	<Logo size={72} wordmark />
	<p class="text-muted">Train together, not alone.</p>

	<!-- ponytail: a link list, not a nav component — one entry point, four
	     destinations. Becomes a real shell when rooms land (M2). -->
	<nav class="mt-2 flex flex-wrap justify-center gap-2">
		<a
			href="/workouts"
			class="rounded bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-white/90"
			>Pick a workout</a
		>
		<a
			href="/rooms"
			class="border-muted/30 hover:border-muted/60 rounded border px-5 py-3 text-sm"
			>Rooms</a
		>
		<a
			href="/ramp"
			class="border-muted/30 hover:border-muted/60 rounded border px-5 py-3 text-sm"
			>Ramp test</a
		>
		<a
			href="/pair"
			class="border-muted/30 hover:border-muted/60 rounded border px-5 py-3 text-sm"
			>Sensors</a
		>
		<a
			href="/history"
			class="border-muted/30 hover:border-muted/60 rounded border px-5 py-3 text-sm"
			>Rides</a
		>
		<a
			href="/profile"
			class="border-muted/30 hover:border-muted/60 rounded border px-5 py-3 text-sm"
			>Profile</a
		>
	</nav>

	<button
		class="border-muted/30 text-muted rounded border px-4 py-2 text-sm hover:text-white"
		onclick={ping}
	>
		ping server
	</button>
	{#if health}
		<pre class="text-watt">{health}</pre>
	{/if}
</main>
