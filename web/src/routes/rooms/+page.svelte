<script lang="ts">
	import { goto } from '$app/navigation';
	import Logo from '$lib/brand/Logo.svelte';
	import { account } from '$lib/account.svelte';
	import { api } from '$lib/api';

	interface RoomSummary {
		slug: string;
		name: string;
		listed: boolean;
	}

	void account.load();

	let rooms = $state<RoomSummary[] | null>(null);
	let error = $state<string | null>(null);
	let name = $state('');
	let code = $state('');
	let busy = $state(false);

	// Signed-in state arrives async; rooms load once it does.
	$effect(() => {
		if (account.loaded && account.me && rooms === null) void load();
	});

	async function load() {
		const res = await api<{ rooms: RoomSummary[] }>('/api/rooms');
		if (res.ok) rooms = res.data.rooms;
		else error = res.error.message;
	}

	async function create() {
		busy = true;
		const res = await api<{ slug: string }>('/api/rooms', {
			method: 'POST',
			json: { name },
		});
		busy = false;
		if (res.ok) void goto(`/r/${res.data.slug}`);
		else error = res.error.message;
	}

	async function joinByCode() {
		busy = true;
		const res = await api<{ slug: string }>('/api/rooms/join', {
			method: 'POST',
			json: { code },
		});
		busy = false;
		if (res.ok) void goto(`/r/${res.data.slug}`);
		else error = res.error.message;
	}
</script>

<main class="mx-auto max-w-3xl px-6 py-10">
	<div class="flex items-center gap-3">
		<Logo size={30} />
		<div>
			<h1 class="font-display text-2xl leading-tight font-bold">Rooms</h1>
			<p class="text-muted text-xs">
				Train together — a room is your crew's place, private by default.
			</p>
		</div>
	</div>

	{#if !account.loaded}
		<p class="text-muted mt-8 text-sm">Loading…</p>
	{:else if !account.me}
		<!-- Empty states teach (.claude/rules/ux.md). -->
		<div
			class="border-muted/15 mt-8 rounded-lg border border-dashed px-6 py-8 text-center"
		>
			<p class="text-sm">Rooms need an account.</p>
			<p class="text-muted mx-auto mt-2 max-w-sm text-xs leading-relaxed">
				Your crew, your rides and your roles live on the server — sign in once
				and every device knows them.
			</p>
			<a
				href="/profile"
				class="mt-5 inline-block rounded bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-white/90"
				>Sign in</a
			>
		</div>
	{:else}
		{#if error}
			<p class="border-z6/40 bg-z6/10 mt-6 rounded-lg border px-4 py-3 text-sm">
				{error}
			</p>
		{/if}

		{#if rooms !== null && rooms.length === 0}
			<div
				class="border-muted/15 mt-8 rounded-lg border border-dashed px-6 py-8 text-center"
			>
				<p class="text-sm">No rooms yet.</p>
				<p class="text-muted mx-auto mt-2 max-w-sm text-xs leading-relaxed">
					Open your first room and share the link — that is the whole invite
					flow.
				</p>
			</div>
		{:else if rooms !== null}
			<ul class="mt-8 grid gap-2">
				{#each rooms as room (room.slug)}
					<li>
						<a
							href="/r/{room.slug}"
							class="border-muted/15 bg-surface-raised hover:border-muted/40 flex items-baseline gap-3 rounded-lg border px-5 py-4"
						>
							<span class="font-display font-bold">{room.name}</span>
							<span class="text-muted font-mono text-xs">/r/{room.slug}</span>
							{#if room.listed}
								<span class="text-muted ml-auto text-[10px] uppercase"
									>listed</span
								>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="mt-8 grid gap-6 sm:grid-cols-2">
			<form
				class="border-muted/15 bg-surface-raised grid gap-3 rounded-lg border p-5"
				onsubmit={(e) => {
					e.preventDefault();
					void create();
				}}
			>
				<span class="text-muted text-[10px] tracking-wider uppercase"
					>open a room</span
				>
				<input
					bind:value={name}
					placeholder="Tuesday Pain Cave"
					maxlength="60"
					required
					class="border-muted/25 focus:border-muted/60 rounded border bg-transparent px-3 py-2 text-sm outline-none"
				/>
				<button
					disabled={busy || !name.trim()}
					class="rounded bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-40"
					>Open room</button
				>
			</form>

			<form
				class="border-muted/15 bg-surface-raised grid gap-3 rounded-lg border p-5"
				onsubmit={(e) => {
					e.preventDefault();
					void joinByCode();
				}}
			>
				<span class="text-muted text-[10px] tracking-wider uppercase"
					>join with a code</span
				>
				<input
					bind:value={code}
					placeholder="VELVET"
					maxlength="6"
					required
					class="border-muted/25 focus:border-muted/60 rounded border bg-transparent px-3 py-2 font-mono text-sm tracking-[0.3em] uppercase outline-none"
				/>
				<button
					disabled={busy || code.trim().length !== 6}
					class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2 text-sm disabled:opacity-40"
					>Join</button
				>
			</form>
		</div>
	{/if}
</main>
