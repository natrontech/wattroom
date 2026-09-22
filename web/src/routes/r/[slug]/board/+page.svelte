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
	// The pins are CrewPins's, the crew Board's too (#2455).
	import AnnouncementStrip from '$lib/announce/AnnouncementStrip.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import CrewPins from '$lib/pins/CrewPins.svelte';
	import { presence } from '$lib/presence.svelte';
	import { useRoom } from '$lib/room/context';

	const room = useRoom();
	// The room context carries the crew's code, not its id or its name
	// (#1236), and the lobby already knows both — the door reads it this way.
	const crew = $derived(presence.rooms.find((r) => r.slug === room.slug)?.crew);
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

	{#if crew}
		<CrewPins crewId={crew.id} crewName={crew.name} />
	{:else}
		<!-- The lobby has not named the crew yet: never blank (errors.md). -->
		<h2 class="font-display mb-3 text-xl font-bold">Pins</h2>
		<Skeleton class="h-28" />
	{/if}
</div>
