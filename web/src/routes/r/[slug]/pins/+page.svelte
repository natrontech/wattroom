<script lang="ts">
	// The room's Pins place (#2405). The crew owns the board and every room of
	// it shows the same one, so this place is where it is read AND changed —
	// a rider wanting the server address is standing in a room, not on the
	// crew's page.
	//
	// ponytail: `pins` is an in-memory mock, not the API. The shape is what is
	// under review; the table, the endpoint and the ADR follow.
	import PinBoard from '$lib/pins/PinBoard.svelte';
	import { pins, removePin, savePin } from '$lib/pins/pins.svelte';
	import { presence } from '$lib/presence.svelte';
	import { useRoom } from '$lib/room/context';

	const room = useRoom();
	// The room context carries the crew's code, not its name (#1236), and the
	// lobby already knows it — the door reads it the same way.
	const crewName = $derived(
		presence.rooms.find((r) => r.slug === room.slug)?.crew?.name ?? '',
	);
</script>

<div class="page">
	<PinBoard
		pins={pins.items}
		{crewName}
		onsave={savePin}
		onremove={(pin) => removePin(pin.id)}
	/>
</div>
