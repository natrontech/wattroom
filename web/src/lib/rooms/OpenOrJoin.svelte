<script lang="ts">
	// Opening a room, and joining one with a code — the two actions /rooms
	// carried beyond a list the sidebar already is (ADR-0020). Home's "your
	// rooms" section, and what the sidebar's + points at.
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import Banner from '$lib/components/Banner.svelte';
	import Select from '$lib/components/Select.svelte';
	import { joinCrew } from '$lib/crew';
	import { creationCrew, crewsOf, openableCrews } from '$lib/nav/crews';
	import { presence } from '$lib/presence.svelte';

	let {
		compact = false,
		crewId,
	}: {
		/**
		 * The sheet the sidebar's + opens (#1199): stacked, no section
		 * heading, the name field focused — the forms are the same.
		 */
		compact?: boolean;
		/**
		 * The crew to open the room in (#1201) — the one on screen. Honoured
		 * when you own or administer it, else the room lands in your own.
		 */
		crewId?: string;
	} = $props();

	// Where the room lands, and the picker that appears only when there is a
	// choice to make — most riders administer one crew (ux.md, the 95% rule).
	const openable = $derived(openableCrews(crewsOf(presence.rooms)));
	let picked = $state<string | undefined>(undefined);
	const target = $derived(creationCrew(openable, picked ?? crewId));

	let newRoomName = $state('');
	let joinCode = $state('');
	let roomBusy = $state(false);
	let roomError = $state<string | null>(null);

	const invalidCode = $derived(
		joinCode.length > 0 && !/^[A-Z0-9]{0,6}$/i.test(joinCode),
	);
	// docs/SPEC.md ownership cap: at the cap the affordance disables with the
	// reason, instead of a 409 on click (ux.md capability gating). The number
	// is the server's, carried on the room list (#603) — nothing here may
	// disagree with what POST /api/rooms would actually do. 0 means the list
	// has not landed yet: gate open, and the 409 still backs it up.
	const owned = $derived(
		presence.rooms.filter((room) => room.role === 'owner').length,
	);
	const ownedOut = $derived(
		presence.maxOwned > 0 && owned >= presence.maxOwned,
	);

	async function createRoom() {
		roomBusy = true;
		const res = await api<{ slug: string }>('/api/rooms', {
			method: 'POST',
			json: target
				? { name: newRoomName, crewId: target.id }
				: { name: newRoomName },
		});
		roomBusy = false;
		if (res.ok) void goto(`/r/${res.data.slug}`);
		else roomError = res.error.message;
	}

	// The code is the crew's (ADR-0038 amended, #1236): joining lands on the
	// crew's page, where its rooms are the doors.
	async function joinByCode() {
		roomBusy = true;
		const res = await joinCrew(joinCode);
		roomBusy = false;
		if (res.ok) {
			presence.reload();
			void goto(`/crew/${res.data.id}`);
		} else roomError = res.error.message;
	}
</script>

<section id={compact ? undefined : 'rooms'}>
	{#if !compact}
		<h2 class="text-muted text-xs font-semibold tracking-widest uppercase">
			Your rooms
		</h2>
	{/if}
	{#if roomError}
		<div class="mt-3"><Banner tone="error">{roomError}</Banner></div>
	{/if}
	<div
		class="grid gap-3 {compact
			? 'grid-cols-1'
			: 'mt-3 sm:grid-cols-2 xl:grid-cols-1'}"
	>
		<div class={compact ? '' : 'panel p-5'}>
			<h3 class="font-display font-bold">
				{#if presence.loaded && openable.length === 0}
					Open your first room
				{:else}
					Open a room{#if target && openable.length === 1}<span
							class="text-muted font-normal">&nbsp;in {target.name}</span
						>{/if}
				{/if}
			</h3>
			<p class="text-muted mt-1 text-xs">
				{#if presence.loaded && openable.length === 0}
					<!-- The day-one fact, said before the click rather than in a toast
					     after it (#1151): a first room makes the crew. -->
					It makes your crew, named after you until you rename it, and the room is
					open to the crew from the start.
				{:else}
					Open to the crew from the start. Anyone new joins the crew with its
					code or link — rooms have none of their own.
				{/if}
			</p>
			{#if openable.length > 1}
				<div class="mt-3">
					<Select
						label="crew"
						options={openable.map((c) => ({ value: c.id, label: c.name }))}
						value={target?.id}
						onchange={(v) => (picked = v)}
					/>
				</div>
			{/if}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					void createRoom();
				}}
			>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					id="open-room-name"
					bind:value={newRoomName}
					maxlength="60"
					class="input mt-3 w-full"
					placeholder="Room name"
					autofocus={compact}
				/>
				<button
					disabled={roomBusy || !newRoomName.trim() || ownedOut}
					class="btn btn-primary mt-3 w-full">Open room</button
				>
				{#if ownedOut}
					<p class="text-muted mt-2 text-xs">
						You own {owned} rooms — the cap. Delete one to open another.
					</p>
				{/if}
			</form>
		</div>

		<div class={compact ? 'border-ink/5 border-t pt-4' : 'panel p-5'}>
			<h3 class="font-display font-bold">
				{compact ? 'Or join a crew with a code' : 'Join a crew with a code'}
			</h3>
			<p class="text-muted mt-1 text-xs">
				Six characters, from whoever invited you to their crew.
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
						? 'border-danger/60'
						: 'border-muted/25 focus:border-muted/60'}"
					placeholder="Crew code"
				/>
				{#if invalidCode}
					<!-- Field-level validation lands under the field (errors.md). -->
					<p class="text-danger mt-1.5 text-xs">
						Codes are letters and numbers only.
					</p>
				{/if}
				<button
					disabled={roomBusy || joinCode.length !== 6 || invalidCode}
					class="btn btn-secondary mt-3 w-full">Join crew</button
				>
			</form>
			<!-- The directory is the other half of "join a room" (#1118), not a
			     place of its own — nav/pages.ts retires anything that is the
			     second half of a page here, and this is exactly that. -->
			<p class="text-muted mt-3 text-xs">
				No code? <a href="/rooms/directory" class="underline"
					>Browse the rooms crews have listed</a
				> — joining one joins its crew.
			</p>
		</div>
	</div>
</section>
