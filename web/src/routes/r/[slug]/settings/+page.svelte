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
	import { CHEER_ICONS, keyFor, ROOM_ICONS } from '$lib/icons';
	import { play } from '$lib/sound/cues';

	interface Member {
		id: string;
		displayName: string;
		role: string;
	}
	interface Room {
		slug: string;
		name: string;
		listed: boolean;
		icon?: string;
		cheers?: string[];
		soundPack?: string;
		role?: string;
		code?: string;
		members?: Member[];
	}

	const slug = $derived(page.params.slug);
	let room = $state<Room | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);
	let confirmDelete = $state(false);

	// Editable copies — PATCHed on change, never on keystroke.
	let name = $state('');
	let listed = $state(false);
	let pack = $state('base');
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
			pack = res.data.soundPack ?? 'base';
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
		const { slug: left, name: leftName, code } = room;
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
		toasts.push(`You left ${leftName}.`, {
			undo: code ? () => void rejoin(code) : undefined,
		});
		await goto('/home');
	}

	async function rejoin(code: string) {
		const res = await api<{ slug: string }>('/api/rooms/join', {
			method: 'POST',
			json: { code },
		});
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		presence.reload();
		void goto(`/r/${res.data.slug}`);
	}

	async function save() {
		busy = true;
		const res = await api(`/api/rooms/${slug}`, {
			method: 'PATCH',
			json: {
				name: name.trim(),
				listed,
				soundPack: pack,
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

	async function setRole(userId: string, role: string) {
		busy = true;
		const res = await api(`/api/rooms/${slug}/role`, {
			method: 'POST',
			json: { userId, role },
		});
		busy = false;
		if (!res.ok) error = res.error.message;
		else if (slug) void load(slug);
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
</script>

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
	     What a member CAN do here is leave, which nothing offered after the
	     rooms page retired into the sidebar (ADR-0020, rider report #415). -->
	<main class="page">
		<h2 class="font-display text-xl font-bold">{room.name}</h2>
		<p class="text-muted mt-1 text-xs">
			Only the owner can change a room's settings — coaches run sessions, owners
			shape the room.
		</p>
		{#if error}
			<div class="mt-4"><Banner tone="error">{error}</Banner></div>
		{/if}
		<section class="border-muted/15 mt-6 rounded-lg border p-6">
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
				<div
					class="mt-1.5 flex flex-wrap items-center gap-1.5"
					role="radiogroup"
					aria-labelledby="room-icon-label"
				>
					<button
						type="button"
						role="radio"
						aria-checked={icon === ''}
						onclick={() => pickIcon('')}
						disabled={busy}
						class="btn btn-secondary btn-xs {icon === ''
							? 'ring-neon bg-neon/15 ring-1'
							: ''}">None</button
					>
					{#each Object.entries(ROOM_ICONS) as [key, Icon] (key)}
						<button
							type="button"
							role="radio"
							aria-checked={icon === key}
							aria-label={key}
							title={key}
							onclick={() => pickIcon(key)}
							disabled={busy}
							class="btn btn-secondary btn-xs {icon === key
								? 'ring-neon bg-neon/15 ring-1'
								: ''}"><Icon size={16} /></button
						>
					{/each}
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
				class="text-muted hover:text-ink mt-3 text-xs underline disabled:opacity-40"
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
									onclick={() => setRole(member.id, 'banned')}
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
				session. Banning kicks a rider out on the spot — the invite link stops
				working for them until you unban.
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
