<script lang="ts">
	/**
	 * The ride's pictures of the world (#4221, #4431), beside the poster on a
	 * closing card: you on the road, and the same moment from above. The
	 * rider saves any of them for Strava. Present only when the world drew
	 * them on this ride, and in their place while the world draws them as it
	 * closes (#4263); through the share sheet on a phone, a download on a
	 * desk (share.ts).
	 */
	import { shareFile } from '$lib/share';
	import { CAMERA_NAMES } from '$lib/world/cameras';
	import { worldPicture } from '$lib/world/picture.svelte';

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
