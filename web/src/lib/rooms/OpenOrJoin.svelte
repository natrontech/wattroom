<script lang="ts">
	// Opening a room, and joining one with a code — the two actions /rooms
	// carried beyond a list the sidebar already is (ADR-0020). Home's "your
	// rooms" section, and what the sidebar's + points at.
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import Banner from '$lib/components/Banner.svelte';
	import { presence } from '$lib/presence.svelte';

	let newRoomName = $state('');
	let joinCode = $state('');
	let roomBusy = $state(false);
	let roomError = $state<string | null>(null);

	const invalidCode = $derived(
		joinCode.length > 0 && !/^[A-Z0-9]{0,6}$/i.test(joinCode),
	);
	// docs/SPEC.md ownership cap: at 3 owned rooms the affordance disables with
	// the reason, instead of a 409 on click (ux.md capability gating).
	const ownedOut = $derived(
		presence.rooms.filter((room) => room.role === 'owner').length >= 3,
	);

	async function createRoom() {
		roomBusy = true;
		const res = await api<{ slug: string }>('/api/rooms', {
			method: 'POST',
			json: { name: newRoomName },
		});
		roomBusy = false;
		if (res.ok) void goto(`/r/${res.data.slug}`);
		else roomError = res.error.message;
	}

	async function joinByCode() {
		roomBusy = true;
		const res = await api<{ slug: string }>('/api/rooms/join', {
			method: 'POST',
			json: { code: joinCode },
		});
		roomBusy = false;
		if (res.ok) void goto(`/r/${res.data.slug}`);
		else roomError = res.error.message;
	}
</script>

<section id="rooms" class="mt-8">
	<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
		Your rooms
	</h2>
	{#if roomError}
		<div class="mt-3"><Banner tone="error">{roomError}</Banner></div>
	{/if}
	<div class="mt-3 grid gap-3 sm:grid-cols-2">
		<div class="panel p-5">
			<h3 class="font-display font-bold">Open a room</h3>
			<p class="text-muted mt-1 text-xs">
				Private by default. Share the link or the code with whoever you ride
				with.
			</p>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					void createRoom();
				}}
			>
				<input
					id="open-room-name"
					bind:value={newRoomName}
					maxlength="60"
					class="input mt-3 w-full"
					placeholder="Room name"
				/>
				<button
					disabled={roomBusy || !newRoomName.trim() || ownedOut}
					class="btn btn-primary mt-3 w-full">Open room</button
				>
				{#if ownedOut}
					<p class="text-muted mt-2 text-xs">
						You own 3 rooms — the cap. Delete one to open another.
					</p>
				{/if}
			</form>
		</div>

		<div class="panel p-5">
			<h3 class="font-display font-bold">Join with a code</h3>
			<p class="text-muted mt-1 text-xs">
				Six characters, from whoever invited you.
			</p>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					void joinByCode();
				}}
			>
				<input
					id="join-code"
					bind:value={joinCode}
					maxlength="6"
					class="mt-3 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm tracking-[0.3em] uppercase outline-none placeholder:tracking-normal placeholder:normal-case {invalidCode
						? 'border-z6/60'
						: 'border-muted/25 focus:border-muted/60'}"
					placeholder="Room code"
				/>
				{#if invalidCode}
					<!-- Field-level validation lands under the field (errors.md). -->
					<p class="text-z6 mt-1.5 text-xs">
						Codes are letters and numbers only.
					</p>
				{/if}
				<button
					disabled={roomBusy || joinCode.length !== 6 || invalidCode}
					class="btn btn-secondary mt-3 w-full">Join room</button
				>
			</form>
		</div>
	</div>
</section>
