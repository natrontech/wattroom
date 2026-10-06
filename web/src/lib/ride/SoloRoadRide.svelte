<script lang="ts">
	/**
	 * /ride?road=<id> (#3027): one of your own roads, loaded, then ridden
	 * alone — or /ride?crew=&plan= (#3621), a planned session's road as the
	 * crew will receive it. Behind the roads dev gate, which /ride checks
	 * before this draws.
	 */
	import Banner from '$lib/components/Banner.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import RoadRiding from '$lib/ride/RoadRiding.svelte';
	import type { Trainer } from '$lib/ble/trainer';
	import { loadPlanRoad, loadRoad, type RideableRoute } from '$lib/ride/roads';

	let {
		roadId = null,
		plan = null,
		from = 0,
		trainer,
	}: {
		roadId?: string | null;
		plan?: { crew: string; id: string } | null;
		from?: number;
		/** Paired on /ride's card and handed over: ride at once (#3671). */
		trainer?: Trainer;
	} = $props();

	let route = $state.raw<RideableRoute | null>(null);
	let start = $state(0);
	let error = $state<string | null>(null);

	async function load() {
		error = null;
		const result = plan
			? await loadPlanRoad(plan.crew, plan.id)
			: await loadRoad(roadId ?? '').then((r) => (r.ok ? { ...r, from } : r));
		if (!result.ok) {
			error = result.error;
			return;
		}
		route = result.route;
		start = result.from;
	}
	$effect(() => void load());
</script>

{#if route}
	<RoadRiding {route} from={start} {trainer} />
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
