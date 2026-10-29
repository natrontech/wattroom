<script lang="ts">
	/**
	 * The ride's picture of the world (#4221), beside the poster on a closing
	 * card: the rider saves either, or both, for Strava. Present only when the
	 * world drew one on this ride, and in its place while the world draws it
	 * as it closes (#4263); through the share sheet on a phone, a download on
	 * a desk (share.ts).
	 */
	import { shareFile } from '$lib/share';
	import { worldPicture } from '$lib/world/picture.svelte';

	let saving = $state(false);
	async function save() {
		const picture = worldPicture.current;
		if (!picture) return;
		saving = true;
		await shareFile(picture, 'wattroom-world.jpg');
		saving = false;
	}
</script>

{#if worldPicture.current}
	<button
		onclick={() => void save()}
		disabled={saving}
		data-testid="world-picture"
		class="btn btn-secondary">World picture</button
	>
{:else if worldPicture.drawing}
	<button disabled class="btn btn-secondary">Drawing…</button>
{/if}
