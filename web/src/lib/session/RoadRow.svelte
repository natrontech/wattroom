<script lang="ts">
	import { loadRoad } from '$lib/ride/roads';
	import type { Road } from '$lib/road/road';
	import type { StoredRoute } from '$lib/road/stored';

	/**
	 * The Road row on a workout pick (#3105, #3100): which of your roads the
	 * workout rides. The blocks stay as written; the pick names the road the
	 * bunch rides at the prescribed pace. A route from Strava is not offered.
	 */
	let {
		routes,
		road = $bindable(),
	}: {
		routes: StoredRoute[];
		/** The chosen road, read; null for none, or while it is being read. */
		road: { id: string; road: Road } | null;
	} = $props();

	let chosen = $state('');
	let error = $state<string | null>(null);

	async function choose(id: string) {
		chosen = id;
		road = null;
		error = null;
		if (!id) return;
		const res = await loadRoad(id);
		if (chosen !== id) return;
		if (res.ok) road = { id, road: res.route.road };
		else error = res.error;
	}
</script>

<label class="text-muted mt-3 flex flex-wrap items-center gap-2 text-xs">
	<span class="eyebrow">road</span>
	<select
		value={chosen}
		onchange={(event) => void choose(event.currentTarget.value)}
		class="input input-xs"
	>
		<option value="">No road</option>
		{#each routes.filter((r) => !r.ownerOnly) as r (r.id)}
			<option value={r.id}>{r.name}</option>
		{/each}
	</select>
	{#if error}
		<span class="text-danger" role="alert">{error}</span>
	{:else if chosen && !road}
		<span aria-busy="true">Reading the road…</span>
	{/if}
</label>
