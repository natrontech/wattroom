<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$lib/api';
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
		soundPack?: string;
		role?: string;
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
			error = null;
		} else {
			room = null;
			error = res.error.message;
		}
	}

	async function save() {
		busy = true;
		const res = await api(`/api/rooms/${slug}`, {
			method: 'PATCH',
			json: { name: name.trim(), listed, soundPack: pack },
		});
		busy = false;
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		if (slug) void load(slug);
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
	<main class="grid min-h-dvh place-items-center px-6">
		<div class="text-center">
			<p class="text-sm">{error}</p>
			<a
				href="/rooms"
				class="text-muted hover:text-ink mt-3 inline-block text-xs underline"
				>Back to rooms</a
			>
		</div>
	</main>
{:else if room && room.role !== 'owner'}
	<!-- Capability gating: no owner, no controls — a hint, never a 403 on click. -->
	<main class="grid min-h-dvh place-items-center px-6">
		<div class="text-center">
			<p class="text-sm">Only {room.name}'s owner can change its settings.</p>
			<a
				href="/r/{room.slug}"
				class="text-muted hover:text-ink mt-3 inline-block text-xs underline"
				>Back to the room</a
			>
		</div>
	</main>
{:else if room}
	<main class="page max-w-2xl">
		<a href="/r/{room.slug}" class="text-muted hover:text-ink text-xs underline"
			>← {room.name}</a
		>
		<h1 class="font-display mt-3 text-3xl font-bold tracking-tight">
			Room settings
		</h1>
		<p class="text-muted mt-2 text-sm">
			Owner only — coaches run sessions, owners shape the room.
		</p>

		{#if error}
			<p
				class="border-z6/40 bg-z6/10 text-z6 mt-4 rounded-lg border px-4 py-2 text-xs"
			>
				{error}
			</p>
		{/if}

		<section class="panel mt-8 p-6">
			<label class="block">
				<span class="eyebrow">room name</span>
				<input
					bind:value={name}
					onchange={save}
					disabled={busy}
					class="input mt-1 w-full"
				/>
			</label>

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
			<h2 class="font-display font-bold">Who's in here</h2>
			<ul class="divide-ink/5 mt-3 divide-y">
				{#each room.members ?? [] as member (member.id)}
					<li class="flex items-center gap-3 py-2.5">
						<span class="text-sm">{member.displayName}</span>
						<span class="eyebrow">{member.role}</span>
						{#if member.role !== 'owner'}
							<button
								onclick={() =>
									setRole(
										member.id,
										member.role === 'coach' ? 'member' : 'coach',
									)}
								disabled={busy}
								class="btn btn-secondary btn-xs ml-auto"
								>{member.role === 'coach'
									? 'Remove coach'
									: 'Make coach'}</button
							>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="text-muted mt-3 text-xs">
				Coaches pick the workout, start the countdown, and can pause or end a
				session.
			</p>
		</section>

		<section class="border-muted/15 mt-3 rounded-lg border p-6">
			<h2 class="font-display font-bold">Delete room</h2>
			<p class="text-muted mt-1.5 text-xs">
				Removes the room, its medal history and its streak for everyone in it.
				Rides already ridden stay in each rider's own history.
			</p>
			{#if confirmDelete}
				<div class="border-z6/50 bg-z6/10 mt-4 rounded-lg border p-4">
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
