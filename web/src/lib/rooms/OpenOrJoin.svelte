<script lang="ts">
	// Opening a room, and joining one with a code — the two actions /rooms
	// carried beyond a list the sidebar already is (ADR-0020). Home's "your
	// rooms" section, and what the sidebar's + points at.
	import { goto } from '$app/navigation';
	import { account } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import Banner from '$lib/components/Banner.svelte';
	import Select from '$lib/components/Select.svelte';
	import { joinCrew } from '$lib/crew';
	import {
		administersNone,
		creationCrew,
		crewsOf,
		leadsWithJoining,
		openableCrews,
	} from '$lib/nav/crews';
	import { presence } from '$lib/presence.svelte';
	// The two code lengths are the server's, generated (#2180): the box that
	// tells a friend's code from a crew's cannot disagree with the door.
	import { CrewCodeLen, FriendCodeLen } from '$lib/protocol';
	import type { RoomCrew } from '$lib/room/room-data';

	let {
		compact = false,
		crewId,
		crew,
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
		/**
		 * The crew whose own page asked for a room here — authoritative, not
		 * a hint: it need not have any rooms yet (audit 2026-09-09).
		 */
		crew?: RoomCrew;
	} = $props();

	// Where the room lands, and the picker that appears only when there is a
	// choice to make — most riders administer one crew (ux.md, the 95% rule).
	const openable = $derived(
		openableCrews(crewsOf(presence.rooms, presence.crews)),
	);
	let picked = $state<string | undefined>(undefined);
	const target = $derived(
		creationCrew(openable, picked ?? crewId, picked ? undefined : crew),
	);

	// A rider carrying an invite is asked to join that crew before founding
	// one (#2144, #2184): the code box leads and founding a crew is the second
	// panel. Keyed on the invite rather than on administering nothing, because
	// the signed-out landing promises a stranger "Open your first room" and a
	// stranger is who arrives without one (ADR-0038 amended 2026-09-17).
	const joinFirst = $derived(
		presence.loaded &&
			leadsWithJoining(
				crewsOf(presence.rooms, presence.crews),
				account.me?.pendingInvite,
			),
	);
	// Nowhere to open a room yet — which is what makes the day-one sentence
	// true ("opening a room makes your crew"), invite or no invite. The order
	// above is a different question and reads a different signal.
	const crewless = $derived(
		presence.loaded && administersNone(crewsOf(presence.rooms, presence.crews)),
	);

	let newRoomName = $state('');
	let joinCode = $state('');
	let roomBusy = $state(false);
	// One slot per form (errors.md): a refused code used to sit above the
	// Open-a-room card, a card away from the field it was about.
	let createError = $state<string | null>(null);
	let joinError = $state<string | null>(null);

	const invalidCode = $derived(
		joinCode.length > 0 && !/^[A-Z0-9]*$/i.test(joinCode),
	);
	// A crew's code is six characters, a friend's eight (friends.go). The box
	// used to cut a pasted friend code to six and send it, and the server's
	// "no crew has that code" sent the rider back to the friend who gave them
	// the right code for a different door.
	const looksLikeFriendCode = $derived(
		joinCode.length > CrewCodeLen &&
			joinCode.length <= FriendCodeLen &&
			/^[A-Z0-9]+$/i.test(joinCode),
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
		else createError = res.error.message;
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
		} else joinError = res.error.message;
	}
</script>

<section id={compact ? undefined : 'rooms'}>
	{#if !compact}
		<!-- Named for what is under it (#2176): the panel leads with joining a
		     crew for an invited rider, and "Your rooms" over that is a heading
		     about something else. A rider with no rooms and no invite gets the
		     landing's own words back (#2184). -->
		<h2 class="eyebrow">
			{joinFirst
				? 'Get into a crew'
				: crewless
					? 'Open your first room'
					: 'Your rooms'}
		</h2>
	{/if}
	<div
		class="grid gap-3 {compact
			? 'grid-cols-1'
			: 'mt-3 sm:grid-cols-2 xl:grid-cols-1'}"
	>
		<!-- Two panels, and which comes first is a decision (ux.md): the
		     DOM order, not a CSS order, so the tab order and a reader agree
		     with the eye. -->
		{#snippet openPanel()}
			<div
				class={compact
					? joinFirst
						? 'border-ink/5 border-t pt-4'
						: ''
					: 'panel panel-lg'}
			>
				<h3 class="font-display font-bold">
					{#if joinFirst}
						Or start a crew of your own
					{:else}
						Open a room{#if target && openable.length === 1}<span
								class="text-muted font-normal">&nbsp;in {target.name}</span
							>{/if}
					{/if}
				</h3>
				<p class="text-muted mt-1 text-xs">
					{#if crewless}
						<!-- The day-one fact, said before the click rather than in a toast
					     after it (#1151): a first room makes the crew. True of every
					     rider who administers none, whichever panel leads (#2184). -->
						Opening a room makes it — named after you until you rename it, and the
						room is open to the crew from the start.
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
				{#if createError}
					<div class="mt-3"><Banner tone="error">{createError}</Banner></div>
				{/if}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						void createRoom();
					}}
				>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id={compact ? 'open-room-name-sheet' : 'open-room-name'}
						bind:value={newRoomName}
						maxlength="60"
						class="input mt-3 w-full"
						placeholder="Room name"
						aria-label="room name"
						autofocus={compact && !joinFirst}
					/>
					<button
						disabled={roomBusy || !newRoomName.trim() || ownedOut}
						class="btn btn-primary mt-3 w-full">Open a room</button
					>
					{#if ownedOut}
						<p class="text-muted mt-2 text-xs">
							You own {owned} rooms — the cap. Delete one to open another.
						</p>
					{/if}
				</form>
			</div>
		{/snippet}
		{#snippet joinPanel()}
			<div
				class={compact
					? joinFirst
						? ''
						: 'border-ink/5 border-t pt-4'
					: 'panel panel-lg'}
			>
				<h3 class="font-display font-bold">
					{compact && !joinFirst
						? 'Or join a crew with a code'
						: 'Join a crew with a code'}
				</h3>
				<p class="text-muted mt-1 text-xs">
					Six characters, from whoever invited you to their crew.
				</p>
				{#if joinError}
					<div class="mt-3"><Banner tone="error">{joinError}</Banner></div>
				{/if}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						void joinByCode();
					}}
				>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id={compact ? 'join-code-sheet' : 'join-code'}
						bind:value={joinCode}
						maxlength={FriendCodeLen}
						class="input mt-3 w-full font-mono tracking-[0.3em] uppercase placeholder:tracking-normal placeholder:normal-case"
						aria-invalid={invalidCode || looksLikeFriendCode
							? 'true'
							: undefined}
						placeholder="Crew code"
						aria-label="crew code"
						autofocus={compact && joinFirst}
					/>
					{#if invalidCode}
						<!-- Field-level validation lands under the field (errors.md). -->
						<p class="text-danger mt-1.5 text-xs">
							Codes are letters and numbers only.
						</p>
					{:else if looksLikeFriendCode}
						<p class="text-danger mt-1.5 text-xs">
							That looks like a friend code — friends are added on <a
								href="/friends"
								class="underline">Friends</a
							>. A crew's code is six characters.
						</p>
					{/if}
					<button
						disabled={roomBusy ||
							joinCode.length !== CrewCodeLen ||
							invalidCode}
						class="btn btn-secondary mt-3 w-full">Join crew</button
					>
				</form>
				<!-- The directory is the other half of "join a room" (#1118), not a
			     place of its own — nav/pages.ts retires anything that is the
			     second half of a page here, and this is exactly that. -->
				<p class="text-muted mt-3 text-xs">
					No code? <a href="/rooms/directory" class="underline">Find a room</a> —
					it lists the rooms crews chose to be found, and joining one joins its crew.
				</p>
			</div>
		{/snippet}
		{#if joinFirst}
			{@render joinPanel()}
			{@render openPanel()}
		{:else}
			{@render openPanel()}
			{@render joinPanel()}
		{/if}
	</div>
</section>
