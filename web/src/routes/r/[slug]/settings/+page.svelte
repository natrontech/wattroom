<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$lib/api';
	import { account } from '$lib/account.svelte';
	import { presence } from '$lib/presence.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { toasts } from '$lib/toast.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import CheerIcon from '$lib/components/CheerIcon.svelte';
	import { CHEER_ICONS, keyFor } from '$lib/icons';
	import IconPicker from '$lib/components/IconPicker.svelte';
	import { play } from '$lib/sound/cues';
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

	/**
	 * Who can find the room, as one ladder (#1204). The server keeps two
	 * columns — listed is the public directory, crewVisible the crew's
	 * sidebar — but a room listed to strangers and hidden from its own crew
	 * is not a state anyone means, so the page walks them as one question.
	 */
	type Reach = 'members' | 'crew' | 'everyone';
	const REACH: Record<Reach, { crewVisible: boolean; listed: boolean }> = {
		members: { crewVisible: false, listed: false },
		crew: { crewVisible: true, listed: false },
		everyone: { crewVisible: true, listed: true },
	};

	const slug = $derived(page.params.slug);
	let room = $state<Room | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);
	let confirmDelete = $state(false);

	// Editable copies — PATCHed on change, never on keystroke.
	let name = $state('');
	let listed = $state(false);
	let crewVisible = $state(false);
	let pack = $state('base');
	let boardEnabled = $state(false);
	let icon = $state('');
	let cheers = $state<string[]>([]);
	// The caller's own settings for this room (#1100) — theirs, not the
	// room's, so they save through their own endpoint and an owner editing
	// the room never touches them.
	let notify = $state(true);
	let onBoard = $state(true);
	let savingPrefs = $state(false);

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
			notify = res.data.me?.notify ?? true;
			onBoard = res.data.me?.onBoard ?? true;
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
			error = res.error.message;
			return;
		}
		error = null;
		if (slug) void load(slug);
	}

	function pickIcon(key: string) {
		icon = key;
		void save();
	}

	const reach = $derived<Reach>(
		listed ? 'everyone' : crewVisible ? 'crew' : 'members',
	);
	function setReach(next: Reach) {
		({ crewVisible, listed } = REACH[next]);
		void save();
	}

	// The palette caps at 8 (docs/SPEC.md); [] tells the server "base set".
	const MAX_CHEERS = 8;
	const full = $derived(cheers.length >= MAX_CHEERS);
	// The curated set — plus whatever an older room still holds that is not
	// in it, so it can be taken out. Nothing new can be added outside the set.
	const palette = $derived([
		...Object.keys(CHEER_ICONS),
		...cheers.filter((c) => !(c in CHEER_ICONS)),
	]);

	function toggleCheer(key: string) {
		if (cheers.includes(key)) cheers = cheers.filter((c) => c !== key);
		else if (!full) cheers = [...cheers, key];
		else return;
		void save();
	}

	async function remove() {
		busy = true;
		const res = await api(`/api/rooms/${slug}`, { method: 'DELETE' });
		busy = false;
		if (!res.ok) {
			error = res.error.message;
			confirmDelete = false;
			return;
		}
		void goto('/rooms');
	}

	async function setRole(userId: string, role: string): Promise<boolean> {
		busy = true;
		const res = await api(`/api/rooms/${slug}/role`, {
			method: 'POST',
			json: { userId, role },
		});
		busy = false;
		if (!res.ok) {
			error = res.error.message;
			return false;
		}
		if (slug) void load(slug);
		return true;
	}

	// Banning is reversible (Unban sets the role right back), so it gets an
	// undo toast rather than a confirm dialog (errors.md).
	async function ban(member: Member) {
		const { id, displayName, role: previousRole } = member;
		if (await setRole(id, 'banned'))
			toasts.push(`Banned ${displayName}.`, {
				undo: () => void setRole(id, previousRole),
			});
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

	// Whole object on every change, like the room's own settings: there is no
	// partial shape to get wrong, and the response is the truth we keep.
	async function savePrefs(next: Partial<RiderPrefs>) {
		if (!room) return;
		savingPrefs = true;
		const res = await api<RiderPrefs>(`/api/rooms/${room.slug}/me`, {
			method: 'PATCH',
			body: JSON.stringify({ notify, onBoard, ...next }),
		});
		savingPrefs = false;
		if (res.ok) {
			notify = res.data.notify;
			onBoard = res.data.onBoard;
			error = null;
		} else {
			// Put the switches back to what the server still holds, so the UI
			// never shows a preference that did not save.
			notify = room.me?.notify ?? true;
			onBoard = room.me?.onBoard ?? true;
			error = res.error.message;
		}
	}
</script>

{#snippet myPrefs()}
	<!-- The rider's own settings (#1100). Between "the owner decides for
		     everybody" and "a global app setting" there was nothing, and the
		     weekly board is the case that shows why: a room-level switch
		     answers "joining must not put you on a board", and leaves the
		     same trap standing for everyone already inside when the owner
		     turns it on (ADR-0036, amended). -->
	<section class="border-muted/15 mt-4 rounded-lg border p-6">
		<h2 class="font-display font-bold">Your settings for this room</h2>
		<p class="text-muted mt-1.5 text-xs">
			Yours alone — nobody else sees them, and the owner cannot change them.
		</p>
		<label
			class="border-muted/15 mt-3 flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3"
		>
			<input
				type="checkbox"
				bind:checked={notify}
				onchange={() => savePrefs({ notify })}
				disabled={savingPrefs}
			/>
			<span class="min-w-0">
				<span class="block text-sm font-medium">Notify me about this room</span>
				<span class="text-muted block text-xs">
					Planned sessions here reach you by email. Turning off every room's
					mail at once lives in your profile.
				</span>
			</span>
		</label>
		<label
			class="border-muted/15 mt-2 flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3"
		>
			<input
				type="checkbox"
				bind:checked={onBoard}
				onchange={() => savePrefs({ onBoard })}
				disabled={savingPrefs}
			/>
			<span class="min-w-0">
				<span class="block text-sm font-medium">
					Include me on the weekly board
				</span>
				<span class="text-muted block text-xs">
					{room?.boardEnabled
						? "Off keeps your kJ off the room's board. It changes nothing else."
						: "This room's board is off, so nothing is ranked here yet — this is what happens if the owner turns it on."}
				</span>
			</span>
		</label>
	</section>
{/snippet}

{#if error && !room}
	<main class="grid min-h-full place-items-center px-6">
		<div class="text-center">
			<p class="text-sm">{error}</p>
			<a
				href="/home"
				class="text-muted hover:text-ink mt-3 inline-block text-xs underline"
				>Back to your rooms</a
			>
		</div>
	</main>
{:else if room && room.role !== 'owner'}
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
					· you joined {joined}{/if}
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

		{@render myPrefs()}

		<section class="border-muted/15 mt-4 rounded-lg border p-6">
			<h2 class="font-display font-bold">Leave room</h2>
			<p class="text-muted mt-1.5 text-xs">
				You drop off the member list and the room leaves your sidebar. Rides you
				rode here stay in your history, and the room's code gets you back in.
			</p>
			<button onclick={leave} disabled={busy} class="btn btn-danger mt-4"
				>Leave room</button
			>
		</section>
	</main>
{:else if room}
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

			<!-- The public-directory listing toggle returns with the directory
			     itself — a checkbox for a shelf that doesn't exist yet teaches a
			     promise the app can't keep (#126). The flag still round-trips in
			     save() so nothing stored is lost. -->
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

		<!-- The one control that takes a room from private to findable — by
		     its crew (#1204, ADR-0038) or by people who have never been in it
		     (#1118, ADR-0039). Worded as the privacy choice it is rather than
		     as two checkboxes, and it says what each step actually does —
		     including the half riders assume and should not: being findable
		     is not being readable. -->
		<section class="panel mt-3 p-6">
			<h2 class="font-display font-bold">Who can find this room</h2>
			<p class="text-muted mt-1.5 text-xs">
				Finding is not joining and it is not reading. Whichever you pick, the
				chat, the members and the numbers stay for people who are actually in
				here.
			</p>
			<div
				class="mt-3 space-y-2"
				role="radiogroup"
				aria-label="who can find this room"
			>
				{#each [{ key: 'members', label: 'Its members', hint: 'Its members, and the crew-mates you let in from the Members place. The rest of the crew sees that it exists and that it is private — not a way in.' }, { key: 'crew', label: room.crew ? `The crew — ${room.crew.name}` : 'The crew', hint: 'Everyone in the crew sees it in their sidebar and can walk in without a code. This is how a new room starts.' }, { key: 'everyone', label: 'Everyone on WattRoom', hint: 'Anyone signed in can find it by name in the directory and join — which puts them in the crew. They see its name and icon first, nothing about who rides here or what you did.' }] as const as step (step.key)}
					<button
						role="radio"
						aria-checked={reach === step.key}
						onclick={() => setReach(step.key)}
						disabled={busy}
						class="flex w-full cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-left {reach ===
						step.key
							? 'ring-neon border-neon/40 bg-neon/10 ring-1'
							: 'border-muted/15'}"
					>
						<span class="min-w-0">
							<span class="block text-sm font-medium">{step.label}</span>
							<span class="text-muted block text-xs">{step.hint}</span>
						</span>
					</button>
				{/each}
			</div>
		</section>

		<!-- An owner is a rider too: they are on their own room's board, and
		     get their own room's mail. Same block as the member view. -->
		{@render myPrefs()}

		<section class="panel mt-3 p-6">
			<h2 class="font-display font-bold">Reactions</h2>
			<p class="text-muted mt-1.5 text-xs">
				The room's reaction vocabulary — cheers mid-ride, reactions on chat. Up
				to {MAX_CHEERS}; the first four are the mid-ride buttons.
			</p>
			<div class="mt-3 flex flex-wrap items-center gap-1.5">
				{#each palette as key (key)}
					{@const pressed = cheers.includes(key)}
					<button
						type="button"
						aria-pressed={pressed}
						aria-label={key}
						title={pressed ? `remove ${key}` : full ? 'the set is full' : key}
						onclick={() => toggleCheer(key)}
						disabled={busy || (!pressed && full)}
						class="border-muted/25 rounded-full border p-2 {pressed
							? 'ring-neon bg-neon/15 ring-1'
							: 'hover:border-muted/60'} disabled:cursor-not-allowed disabled:opacity-40"
						><CheerIcon cheer={key} size={18} /></button
					>
				{/each}
				<span class="text-muted ml-1 text-xs tabular-nums"
					>{cheers.length} of {MAX_CHEERS}</span
				>
			</div>
			<button
				onclick={() => ((cheers = []), void save())}
				disabled={busy}
				class="btn-link mt-3 text-xs disabled:opacity-40"
				>Reset to the base set</button
			>
		</section>

		<section class="panel mt-3 p-6">
			<h2 class="font-display font-bold">Who's in here</h2>
			<ul class="divide-ink/5 mt-3 divide-y">
				{#each room.members ?? [] as member (member.id)}
					<li class="flex items-center gap-3 py-2.5">
						<span class="text-sm {member.role === 'banned' ? 'text-muted' : ''}"
							>{member.displayName}</span
						>
						<span class="eyebrow">{member.role}</span>
						{#if member.role === 'banned'}
							<button
								onclick={() => setRole(member.id, 'member')}
								disabled={busy}
								class="btn btn-secondary btn-xs ml-auto">Unban</button
							>
						{:else if member.role !== 'owner'}
							<span class="ml-auto flex gap-1.5">
								<button
									onclick={() =>
										setRole(
											member.id,
											member.role === 'coach' ? 'member' : 'coach',
										)}
									disabled={busy}
									class="btn btn-secondary btn-xs"
									>{member.role === 'coach'
										? 'Remove coach'
										: 'Make coach'}</button
								>
								<button
									onclick={() => ban(member)}
									disabled={busy}
									class="btn btn-danger btn-xs">Ban</button
								>
							</span>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="text-muted mt-3 text-xs">
				Coaches pick the workout, start the countdown, and can pause or end a
				session. Banning kicks a rider out on the spot — the room stays shut to
				them until you unban, whatever the crew lets them into.
			</p>
		</section>

		<section class="border-muted/15 mt-3 rounded-lg border p-6">
			<h2 class="font-display font-bold">Delete room</h2>
			<p class="text-muted mt-1.5 text-xs">
				Removes the room, its medal history and its streak for everyone in it.
				Rides already ridden stay in each rider's own history.
			</p>
			{#if confirmDelete}
				<div class="border-danger/50 bg-danger/10 mt-4 rounded-lg border p-4">
					<p class="text-xs">
						Delete “{room.name}” for all {room.members?.length ?? 0} members? This
						can't be undone.
					</p>
					<div class="mt-3 flex gap-2">
						<button
							onclick={remove}
							disabled={busy}
							class="btn btn-danger-solid">Delete room</button
						>
						<button
							onclick={() => (confirmDelete = false)}
							class="btn btn-secondary">Cancel</button
						>
					</div>
				</div>
			{:else}
				<button
					onclick={() => (confirmDelete = true)}
					class="btn btn-danger mt-4">Delete room</button
				>
			{/if}
		</section>
	</main>
{/if}
