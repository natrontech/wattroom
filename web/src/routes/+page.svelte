<script lang="ts">
	let health = $state<string | null>(null);

	async function ping() {
		const res = await fetch('/api/healthz');
		health = res.ok ? await res.text() : `error ${res.status}`;
	}
</script>

<main
	class="bg-surface flex min-h-screen flex-col items-center justify-center gap-6 text-white"
>
	<h1 class="text-5xl font-bold tracking-tight">
		Watt<span class="text-watt">Room</span>
	</h1>
	<p class="text-muted">Train together, not alone.</p>
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
