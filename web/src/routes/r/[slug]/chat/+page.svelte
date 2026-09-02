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
</script>

<div class="flex h-full min-h-0 flex-col">
	<RoomThread slug={room.slug} />
</div>
