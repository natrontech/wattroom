<script lang="ts">
	// A crew's pins as a section (ADR-0056): the read, the writes and the
	// states around PinBoard, which owns the grid. The crew's Board (#2455)
	// and a room's Board (#2413) both draw it; the page around it composes
	// whatever else it shows.
	import Banner from '$lib/components/Banner.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import PinBoard from '$lib/pins/PinBoard.svelte';
	import {
		createPin,
		deletePin,
		fetchPins,
		updatePin,
		type Pin,
		type PinDraft,
	} from '$lib/pins/pins';
	import { presence } from '$lib/presence.svelte';

	let { crewId, crewName }: { crewId: string; crewName: string } = $props();

	let pins = $state<Pin[]>([]);
	let error = $state<string | null>(null);
	let loadedCrew = $state<string | null>(null);

	async function load(id: string, quiet = false) {
		const res = await fetchPins(id);
		if (res.ok) {
			pins = res.data;
			error = null;
			loadedCrew = id;
			return;
		}
		// Only the FIRST read of a crew fails loudly. This also runs on every
		// lobby ping, and one hiccup replacing the board you are reading with
		// a sentence would be worse than a stale board.
		if (!quiet) {
			error = res.error.message;
			loadedCrew = id;
		}
	}

	$effect(() => {
		const id = crewId;
		if (loadedCrew !== id) {
			pins = [];
			error = null;
			void load(id);
			return;
		}
		// Someone else pinned something: every write pings the lobby, and the
		// ping is how this client hears about it (#570).
		void presence.version;
		void load(id, true);
	});

	/** Write, then re-read: the server owns ids, order and timestamps. */
	async function save(draft: PinDraft, id?: string) {
		const res = id
			? await updatePin(crewId, id, draft)
			: await createPin(crewId, draft);
		if (!res.ok) return res.error.message;
		await load(crewId, true);
		return null;
	}

	async function remove(pin: Pin) {
		const res = await deletePin(crewId, pin.id);
		if (!res.ok) return res.error.message;
		await load(crewId, true);
		return null;
	}
</script>

{#if error}
	<h2 class="font-display mb-3 text-xl font-bold">Pins</h2>
	<Banner tone="error">
		{error}
		{#snippet action()}
			<button onclick={() => void load(crewId)} class="btn btn-secondary btn-xs"
				>Retry</button
			>
		{/snippet}
	</Banner>
{:else if loadedCrew === null}
	<!-- Never blank (errors.md): a cold server takes seconds and the void
	     read as broken. -->
	<h2 class="font-display mb-3 text-xl font-bold">Pins</h2>
	<Skeleton class="h-28" />
{:else}
	<PinBoard {pins} {crewName} onsave={save} onremove={remove} />
{/if}
