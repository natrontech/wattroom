<script lang="ts">
	/**
	 * /ride?road=<id> (#3027): one of your own roads, loaded, then ridden
	 * alone. Behind the roads dev gate, which /ride checks before this draws.
	 */
	import Banner from '$lib/components/Banner.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import RoadRiding from '$lib/ride/RoadRiding.svelte';
	import { loadRoad, type RideableRoute } from '$lib/ride/roads';

	let { roadId, from = 0 }: { roadId: string; from?: number } = $props();

	let route = $state.raw<RideableRoute | null>(null);
	let error = $state<string | null>(null);

	async function load() {
		error = null;
		const result = await loadRoad(roadId);
		if (result.ok) route = result.route;
		else error = result.error;
	}
	$effect(() => void load());
</script>

{#if route}
	<RoadRiding {route} {from} />
{:else if error}
	<div class="m-auto w-full max-w-2xl">
		<Banner tone="error">
			{error}
			{#snippet action()}
				<button onclick={() => void load()} class="btn-link text-xs"
					>Try again</button
				>
			{/snippet}
		</Banner>
	</div>
{:else}
	<div class="m-auto w-full max-w-2xl">
		<Skeleton class="h-8 w-56" />
		<Skeleton class="mt-6 h-48" />
	</div>
{/if}
