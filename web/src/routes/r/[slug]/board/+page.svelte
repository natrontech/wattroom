<script lang="ts">
	// The room's Board (#2413): the first place in the room, above the Lounge.
	// What the room and its crew wrote down — the coach's standing notice, and
	// the crew's pins.
	//
	// The order is the argument. A notice on a page a rider must go and open
	// is filed rather than announced, which is why ADR-0057 kept it off one;
	// on the FIRST row of the room it is the door they come through. The
	// Lounge keeps its strip all the same, for the rider already inside when
	// a coach puts one up.
	//
	// Sections, not a union: the notice and the pins are different things
	// with different owners and different permissions, and the page composes
	// them. What arrives next — a workout somebody posted, a ride worth
	// showing — is another section, not a row in a table that had to be
	// generic before anybody knew what went in it.
	//
	// This owns the four states (errors.md); PinBoard owns the pins.
	import AnnouncementStrip from '$lib/announce/AnnouncementStrip.svelte';
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
	import { useRoom } from '$lib/room/context';

	const room = useRoom();
	// The room context carries the crew's code, not its id or its name
	// (#1236), and the lobby already knows both — the door reads it this way.
	const crew = $derived(presence.rooms.find((r) => r.slug === room.slug)?.crew);

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
		// a sentence would be worse than a stale board — the room layout and
		// the crew page both draw this line.
		if (!quiet) {
			error = res.error.message;
			loadedCrew = id;
		}
	}

	$effect(() => {
		const id = crew?.id;
		if (!id) return;
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
		const crewId = crew?.id;
		if (!crewId) return 'This room has no crew to pin to.';
		const res = id
			? await updatePin(crewId, id, draft)
			: await createPin(crewId, draft);
		if (!res.ok) return res.error.message;
		await load(crewId, true);
		return null;
	}

	async function remove(pin: Pin) {
		const crewId = crew?.id;
		if (!crewId) return 'This room has no crew to pin to.';
		const res = await deletePin(crewId, pin.id);
		if (!res.ok) return res.error.message;
		await load(crewId, true);
		return null;
	}
</script>

<div class="page">
	<h2 class="font-display mb-1 text-xl font-bold">Board</h2>
	<p class="text-muted mb-5 text-xs">
		What this room and {crew?.name ?? 'its crew'} wrote down.
	</p>

	<!-- The notice first, and above the pins: it is the thing with a clock on
	     it. Taking it down is the coach's, and the strip draws nothing at all
	     when there is none — no empty slot holding the place. -->
	<AnnouncementStrip
		announcement={room.announcement}
		canClear={room.myRole === 'owner' || room.myRole === 'coach'}
		onclear={() => room.clearAnnouncement()}
	/>

	{#if error}
		<h2 class="font-display mb-3 text-xl font-bold">Pins</h2>
		<Banner tone="error">
			{error}
			{#snippet action()}
				<button
					onclick={() => crew && void load(crew.id)}
					class="btn btn-secondary btn-xs">Retry</button
				>
			{/snippet}
		</Banner>
	{:else if loadedCrew === null}
		<!-- Never blank (errors.md): a cold server takes seconds and the void
		     read as broken. -->
		<h2 class="font-display mb-3 text-xl font-bold">Pins</h2>
		<Skeleton class="h-28" />
	{:else}
		<PinBoard
			{pins}
			crewName={crew?.name ?? ''}
			onsave={save}
			onremove={remove}
		/>
	{/if}
</div>
