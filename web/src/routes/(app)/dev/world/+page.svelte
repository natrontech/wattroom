<script lang="ts">
	// The ride-world prototype (#3021). World.svelte comes in through a
	// dynamic import so three.js lands in its own chunk, fetched only here —
	// never in the eager shell every other page pays for.
	import { setWorldSlot, worldSlotOn } from '$lib/world/flag';
	import { STYLES } from './styles';

	// Slot 2 on this device's rides (#3031): the world behind the docked
	// slots, until #3082 has measured it and the default flips.
	let slot = $state(worldSlotOn());

	const load = () =>
		import('$lib/world/World.svelte').catch((err: unknown) => {
			console.error('world: the renderer did not load', err);
			throw err;
		});
	let world = $state(load());
</script>

<label class="page flex items-center gap-2 pb-0 text-sm">
	<input
		type="checkbox"
		checked={slot}
		onchange={(e) => setWorldSlot((slot = e.currentTarget.checked))}
	/>
	Ride in the world on this device — slot 2 of /ride and a voice channel's Training
</label>

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
