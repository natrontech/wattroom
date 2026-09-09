<script lang="ts">
	import { formatMonth } from '$lib/format';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$lib/api';
	import { account } from '$lib/account.svelte';
	import { presence } from '$lib/presence.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { toasts } from '$lib/toast.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import CheerIcon from '$lib/components/CheerIcon.svelte';
	import { keyFor } from '$lib/icons';
	import RoomMyPrefs from './RoomMyPrefs.svelte';
	import RoomReach from './RoomReach.svelte';
	import RoomReactions from './RoomReactions.svelte';
	import RoomAutoplay from './RoomAutoplay.svelte';
	import IconPicker from '$lib/components/IconPicker.svelte';
	import { play } from '$lib/sound/cues';
	import { confirm } from '$lib/confirm.svelte';
	import { device } from '$lib/device.svelte';
	import {
		joinedOn,
		memberCount,
		ownerName,
		packLabel,
	} from '$lib/room/settings-summary';

	interface Member {
		id: string;
		displayName: string;
		role: string;
		joinedAt?: string;
	}
	interface RiderPrefs {
		notify: boolean;
		onBoard: boolean;
	}
	interface Room {
		slug: string;
		name: string;
		listed: boolean;
		me?: RiderPrefs;
		icon?: string;
		cheers?: string[];
		soundPack?: string;
		boardEnabled?: boolean;
		/** Open to the crew (ADR-0038) — absent means shut (#1204). */
		crewVisible?: boolean;
		crew?: { id: string; name: string };
		role?: string;
		code?: string;
		members?: Member[];
	}

	const slug = $derived(page.params.slug);
	let room = $state<Room | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);

	// Editable copies — PATCHed on change, never on keystroke.
	let name = $state('');
	let listed = $state(false);
	let crewVisible = $state(false);
	let pack = $state('base');
	let boardEnabled = $state(false);
	let icon = $state('');
	let cheers = $state<string[]>([]);

	$effect(() => {
		if (slug) void load(slug);
	});

	async function load(current: string) {
		const res = await api<Room>(`/api/rooms/${current}`);
		if (res.ok) {
			room = res.data;
			name = res.data.name;
			listed = res.data.listed;
			crewVisible = res.data.crewVisible ?? false;
			pack = res.data.soundPack ?? 'base';
			boardEnabled = res.data.boardEnabled ?? false;
			// A room from before #447 holds emoji; edited as the keys they mean,
			// so the next save stores keys.
			icon = keyFor(res.data.icon ?? '');
			cheers = (res.data.cheers ?? []).map(keyFor);
			error = null;
		} else {
			room = null;
			error = res.error.message;
		}
	}

	// Leaving a room you do not own (#415): the one thing a member can do on
	// this page. Undo over confirm (errors.md) — the code gets you straight back.
	async function leave() {
		if (!room || !account.me) return;
		const { slug: left, name: leftName } = room;
		busy = true;
		const res = await api(`/api/rooms/${left}/members/${account.me.id}`, {
			method: 'DELETE',
		});
		busy = false;
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		roomConnection.leave();
		presence.reload();
		// Undo walks back in through the crew (#1236): the room's door is still
		// open to a crew member; a private room says so if it is not.
		toasts.push(`You left ${leftName}.`, { undo: () => void rejoin(left) });
		await goto('/home');
	}

	async function rejoin(slug: string) {
		const res = await api(`/api/rooms/${slug}/join`, { method: 'POST' });
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		presence.reload();
		void goto(`/r/${slug}`);
	}

	async function save() {
		busy = true;
		const res = await api(`/api/rooms/${slug}`, {
			method: 'PATCH',
			json: {
				name: name.trim(),
				listed,
				crewVisible,
				soundPack: pack,
				boardEnabled,
				icon,
				cheers,
			},
		});
		busy = false;
		if (!res.ok) {
			// A toast, where the control that failed is (errors.md) — the
			// banner sat a screen above the reach ladder — and a re-read, so
			// the form does not keep showing the values the server refused.
			toasts.push(res.error.message, { tone: 'error' });
			if (slug) void load(slug);
			return;
		}
		if (slug) void load(slug);
	}

	function pickIcon(key: string) {
		icon = key;
		void save();
	}

	// The one dialog every destructive action asks through ($lib/confirm);
	// this page hand-rolled its own beside it.
	async function confirmDelete() {
		if (!room) return;
		const n = room.members?.length ?? 0;
		const ok = await confirm({
			title: `Delete “${room.name}” for all ${n} member${n === 1 ? '' : 's'}?`,
			body: "Removes the room, its medal history and its streak for everyone in it. Rides already ridden stay in each rider's own history. This can't be undone.",
			action: 'Delete room',
			cancel: 'Keep the room',
		});
		if (ok) await remove();
	}

	async function remove() {
		busy = true;
		const res = await api(`/api/rooms/${slug}`, { method: 'DELETE' });
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		// Home's open-a-room form, directly: /rooms has been a redirect to
		// exactly this since ADR-0020, and the hop through it was a flash (#1329).
		void goto('/home#rooms');
	}

	// Packs are parameter sets, not downloads — custom ones are a fast-follow (WATTROOM.md).
	const packs = [
		{
			id: 'base',
			label: 'Base',
			hint: 'The synthwave set. Ships with every room.',
		},
		{
			id: 'silent',
			label: 'Silent',
			hint: 'Visual cues only. Voice stays on.',
		},
	];

	// What a member's own room read already carries (#1099): the code, the
	// sound pack, the cheers and the roster all arrive in the same GET, so the
	// read-only view costs no second request.
	const roster = $derived(room?.members ?? []);
	const owner = $derived(ownerName(roster));
	const members = $derived(memberCount(roster));
	const joined = $derived(joinedOn(roster, account.me?.id));
	const soundPackLabel = $derived(packLabel(packs, room?.soundPack));
</script>

{#if error && !room}
	<main class="grid min-h-full place-items-center px-6">
		<div class="text-center">
			<div class="text-left">
				<Banner tone="error">
					{error}
					{#snippet action()}
						<button
							onclick={() => slug && void load(slug)}
							class="btn-link text-xs">Retry</button
						>
					{/snippet}
				</Banner>
			</div>
			<a
				href="/home"
				class="text-muted hover:text-ink mt-3 inline-block text-xs underline"
				>Back to your rooms</a
			>
		</div>
	</main>
{:else if !room}
	<!-- The first round trip: never a blank column (errors.md) — the page
	     matched no branch at all while the read was in flight (audit
	     2026-09-09). -->
	<main class="page">
		<Skeleton class="h-8 w-48" />
		<Skeleton class="mt-6 h-40" />
	</main>
{:else if room.role !== 'owner'}
	<!-- Capability gating: no owner, no controls — a hint, never a 403 on click.
	     But the gating was the whole page (#1099): a member arrived asking what
	     this room is and how to get somebody else into it, and was told what
	     they cannot do. The invite and the room's own facts come first now; the
	     one line about who may change them sits under them rather than being
	     them. Everything here is already in the member's own room read. -->
	<main class="page">
		<header class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<h2 class="font-display text-xl font-bold">{room.name}</h2>
			<p class="text-muted text-xs">
				{members}
				{members === 1 ? 'member' : 'members'} · {owner} owns it{#if joined}{' '}
					· you joined {formatMonth(joined)}{/if}
			</p>
		</header>
		{#if error}
			<div class="mt-4"><Banner tone="error">{error}</Banner></div>
		{/if}

		<!-- Inviting is the crew's (#1236): a room has no code or link of its
		     own, so a member who came here to get somebody in is pointed at it. -->
		{#if room.crew}
			<p class="text-muted mt-6 text-xs">
				To get someone in, invite them to the crew — <a
					href="/crew/{room.crew.id}"
					class="underline">{room.crew.name}</a
				> has the code and the link. Rooms have none of their own.
			</p>
		{/if}

		<section class="border-muted/15 mt-4 rounded-lg border p-6">
			<h2 class="font-display font-bold">What's on</h2>
			<dl class="mt-4 space-y-3 text-sm">
				<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
					<dt class="eyebrow w-28 shrink-0">sound pack</dt>
					<dd>{soundPackLabel}</dd>
				</div>
				<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
					<dt class="eyebrow w-28 shrink-0">weekly board</dt>
					<dd>{room.boardEnabled ? 'Running' : 'Off'}</dd>
				</div>
				{#if room.cheers && room.cheers.length > 0}
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
						<dt class="eyebrow w-28 shrink-0">reactions</dt>
						<dd class="flex flex-wrap items-center gap-1.5">
							{#each room.cheers as cheer (cheer)}
								<CheerIcon cheer={keyFor(cheer)} size={18} />
							{/each}
						</dd>
					</div>
				{/if}
			</dl>
			<p class="text-muted mt-4 text-xs">
				Only the owner can change these — coaches run sessions, owners shape the
				room.
			</p>
		</section>

		<!-- Autoplay is the coach's as much as the owner's (SPEC roles matrix),
		     so the one setting a coach may change on this page is live for
		     them and read-only for everyone else. -->
		<RoomAutoplay slug={room.slug} canManage={room.role === 'coach'} />

		<RoomMyPrefs
			slug={room.slug}
			me={room.me}
			boardEnabled={room.boardEnabled}
		/>

		<section class="border-muted/15 mt-4 rounded-lg border p-6">
			<h2 class="font-display font-bold">Leave room</h2>
			<p class="text-muted mt-1.5 text-xs">
				You drop off the member list and the room leaves your sidebar. Rides you
				rode here stay in your history{crewVisible
					? ', and you can walk back in any time — the room is open to the crew'
					: ', and the owner can let you back in — the room is private'}.
			</p>
			<button onclick={leave} disabled={busy} class="btn btn-danger mt-4"
				>Leave room</button
			>
		</section>
	</main>
{:else}
	<main class="page">
		<h2 class="font-display text-xl font-bold">Room settings</h2>
		<p class="text-muted mt-1 text-xs">
			Owner only — coaches run sessions, owners shape the room.
		</p>
		{#if device.narrow}
			<!-- Not offered in the phone's drawer (#412), so anyone standing here
			     arrived by link or bookmark. Say so rather than let the forms
			     imply this is where the job gets done. -->
			<p class="text-muted/70 mt-2 text-[11px]">
				Laid out for a wider screen — this is a desk job, not a mid-ride one.
			</p>
		{/if}

		{#if error}
			<div class="mt-4">
				<Banner tone="error">{error}</Banner>
			</div>
		{/if}

		<section class="panel mt-5 p-6">
			<label class="block">
				<span class="eyebrow">room name</span>
				<input
					bind:value={name}
					onchange={save}
					disabled={busy}
					class="input mt-1 w-full"
				/>
			</label>

			<div class="mt-4">
				<span class="eyebrow" id="room-icon-label">room icon</span>
				<div class="mt-1.5">
					<IconPicker
						value={icon}
						onpick={pickIcon}
						disabled={busy}
						labelledby="room-icon-label"
					/>
				</div>
				<span class="text-muted mt-1.5 block text-xs"
					>Next to the name everywhere.</span
				>
			</div>
		</section>

		<section class="panel mt-3 p-6">
			<h2 class="font-display font-bold">Sound pack</h2>
			<div class="mt-3 grid gap-2">
				{#each packs as option (option.id)}
					<label
						class="flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 {pack ===
						option.id
							? 'border-ink/40'
							: 'border-muted/15'}"
					>
						<input
							type="radio"
							bind:group={pack}
							value={option.id}
							onchange={save}
							disabled={busy}
						/>
						<span class="min-w-0">
							<span class="block text-sm font-medium">{option.label}</span>
							<span class="text-muted block text-xs">{option.hint}</span>
						</span>
						{#if option.id !== 'silent'}
							<button
								onclick={(event) => (event.preventDefault(), play('fanfare'))}
								class="btn btn-secondary btn-xs ml-auto shrink-0"
								>Preview</button
							>
						{/if}
					</label>
				{/each}
			</div>
			<p class="text-muted mt-3 text-xs">
				Custom packs — insider memes, your own klaxon — aren't here yet.
			</p>
		</section>

		<RoomAutoplay slug={room.slug} canManage={true} />

		<!-- Off is the default and turning it on is a deliberate act (ADR-0036):
		     being in a room must not put a rider on a board. The copy says what
		     appears and to whom BEFORE it appears — a joiner should be able to
		     see what this room shares without joining it first. -->
		<section class="panel mt-3 p-6">
			<h2 class="font-display font-bold">Weekly board</h2>
			<p class="text-muted mt-1.5 text-xs">
				Off by default. Turned on, the Lounge lists everyone's kJ for the
				current week under the crew's tiles, with their category beside it so it
				is clear who is comparable. It resets every Monday, it never leaves this
				room, and nothing is kept from week to week.
			</p>
			<label
				class="mt-3 flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 {boardEnabled
					? 'border-ink/40'
					: 'border-muted/15'}"
			>
				<input
					type="checkbox"
					bind:checked={boardEnabled}
					onchange={save}
					disabled={busy}
				/>
				<span class="min-w-0">
					<span class="block text-sm font-medium"
						>{boardEnabled ? 'On' : 'Off'}</span
					>
					<span class="text-muted block text-xs">
						{boardEnabled
							? 'Everyone here can see how the week is going.'
							: 'The crew tiles show what you did together, and nobody is ranked.'}
					</span>
				</span>
			</label>
		</section>

		<RoomReach
			bind:listed
			bind:crewVisible
			crewName={room.crew?.name}
			{busy}
			onchange={save}
		/>

		<!-- An owner is a rider too: they are on their own room's board, and
		     get their own room's mail. Same block as the member view. -->
		<RoomMyPrefs
			slug={room.slug}
			me={room.me}
			boardEnabled={room.boardEnabled}
		/>

		<RoomReactions bind:cheers {busy} onchange={save} />

		<!-- Roles and bans are the Members place's (#703, #666): the roster with
		     its menu is there, and a second copy here drifted (#1265). One line
		     points at it; nothing here duplicates it. -->
		<p class="text-muted mt-6 text-xs">
			Coaches, bans and handing the room on live on <a
				href="/r/{room.slug}/members"
				class="underline">Members</a
			>, on each person.
		</p>

		<section class="border-muted/15 mt-3 rounded-lg border p-6">
			<h2 class="font-display font-bold">Delete room</h2>
			<p class="text-muted mt-1.5 text-xs">
				Removes the room, its medal history and its streak for everyone in it.
				Rides already ridden stay in each rider's own history.
			</p>
			<button
				onclick={() => void confirmDelete()}
				disabled={busy}
				class="btn btn-danger mt-4">Delete room</button
			>
		</section>
	</main>
{/if}
