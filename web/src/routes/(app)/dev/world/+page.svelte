<script lang="ts">
	// The ride-world prototype (#3021). World.svelte comes in through a
	// dynamic import so three.js lands in its own chunk, fetched only here —
	// never in the eager shell every other page pays for.
	import { STYLES } from './styles';

	const load = () =>
		import('$lib/world/World.svelte').catch((err: unknown) => {
			console.error('world: the renderer did not load', err);
			throw err;
		});
	let world = $state(load());
</script>

{#await world}
	<p class="text-muted page text-sm">Loading the world renderer…</p>
{:then { default: World }}
	<World styles={STYLES} />
{:catch}
	<div class="page">
		<div class="panel panel-lg max-w-sm">
			<p class="text-sm">The world renderer did not load.</p>
			<p class="text-muted mt-1 text-sm">
				Usually the dev server restarted underneath the page, and trying again
				fetches it anew. If it fails again, the browser console has the reason.
			</p>
			<button class="btn btn-secondary mt-4" onclick={() => (world = load())}
				>Try again</button
			>
		</div>
	</div>
{/await}
