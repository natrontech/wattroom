<script lang="ts">
	/**
	 * The ride's pictures of the world (#4221, #4431), beside the poster on a
	 * closing card: you on the road, and the same moment from above. The
	 * rider saves any of them for Strava. Present only when the world drew
	 * them on this ride, and in their place while the world draws them as it
	 * closes (#4263); through the share sheet on a phone, a download on a
	 * desk (share.ts).
	 *
	 * The photos the rider took go to the saved ride's page (`rideId`), and
	 * the card says so with the way there: the phone that took them finds
	 * them on that page too.
	 */
	import { shareFile } from '#lib/share.ts';
	import { CAMERA_NAMES } from '#lib/world/cameras.ts';
	import { worldPicture } from '#lib/world/picture.svelte.ts';

	let { rideId }: { rideId?: string | null } = $props();

	$effect(() => {
		if (rideId) void worldPicture.keepWith(rideId);
	});

	const shots = $derived([
		{
			blob: worldPicture.rider,
			label: 'World picture',
			file: 'wattroom-world.jpg',
			id: 'world-picture',
		},
		{
			blob: worldPicture.above,
			label: `${CAMERA_NAMES.heli} picture`,
			file: 'wattroom-overhead.jpg',
			id: 'world-picture-above',
		},
	]);
	const photos = $derived(worldPicture.photos.length);
	const keeping = $derived(worldPicture.keeping);

	let saving = $state<string | null>(null);
	async function save(blob: Blob, file: string) {
		saving = file;
		await shareFile(blob, file);
		saving = null;
	}
</script>

{#each shots as shot (shot.id)}
	{#if shot.blob}
		{@const blob = shot.blob}
		<button
			onclick={() => void save(blob, shot.file)}
			disabled={saving === shot.file}
			data-testid={shot.id}
			class="btn btn-secondary">{shot.label}</button
		>
	{/if}
{/each}
{#if worldPicture.drawing && !worldPicture.rider && !worldPicture.above}
	<button disabled class="btn btn-secondary">Drawing…</button>
{/if}
{#if rideId && photos > 0}
	{#if keeping.error}
		<button
			onclick={() => void worldPicture.retry()}
			data-testid="ride-photos-retry"
			class="btn btn-secondary">Save photos again</button
		>
	{:else if keeping.kept < photos}
		<button disabled class="btn btn-secondary">Saving photos…</button>
	{:else}
		<a
			href="/history/{rideId}#photos"
			data-testid="ride-photos-link"
			class="btn btn-secondary"
			>{photos === 1 ? 'Your photo' : `Your ${photos} photos`}</a
		>
	{/if}
{/if}
