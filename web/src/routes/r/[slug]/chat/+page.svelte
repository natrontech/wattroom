<script lang="ts">
	// The Chat place — the room's talk with the whole content column.
	// ADR-0020 keeps chat in the people column so it is there in every place;
	// this is that same log given room to read back, and the only shape that
	// works below xl, where the column is a summonable sheet.
	//
	// One log, not a copy: RoomThread reads the room connection while you are
	// standing in the room and polls the backlog only from outside (#468).
	import RoomThread from '$lib/messages/RoomThread.svelte';
	import { useRoom } from '$lib/room/context';

	const room = useRoom();
	const isOwner = $derived(room.myRole === 'owner');
</script>

<div class="flex h-full min-h-0 flex-col">
	<!-- The room's own reminders ride this thread (#359): the hub cannot
	     send them, so the client derives them from the same upcoming list
	     the plan card renders. -->
	<RoomThread
		slug={room.slug}
		reminders={room.reminders}
		ban={isOwner ? (id, name) => room.ban(id, name) : undefined}
	/>
</div>
