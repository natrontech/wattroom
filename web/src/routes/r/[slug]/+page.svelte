<script lang="ts">
	import { page } from '$app/state';
	import Logo from '$lib/brand/Logo.svelte';
	import { account } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import RoomLive from '$lib/room/RoomLive.svelte';

	interface Member {
		id: string;
		displayName: string;
		avatarUrl?: string;
		role: string;
	}
	interface Medal {
		kind: string;
		rider: string;
		awardedAt: string;
	}
	interface Room {
		slug: string;
		name: string;
		listed: boolean;
		code?: string;
		role?: string;
		members?: Member[];
		medals?: Medal[];
		streakWeeks?: number;
		monthKj?: number;
	}

	void account.load();

	const slug = $derived(page.params.slug);
	let room = $state<Room | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);

	$effect(() => {
		if (slug) void load(slug);
	});

	async function load(current: string) {
		const res = await api<Room>(`/api/rooms/${current}`);
		if (res.ok) {
			room = res.data;
			error = null;
		} else {
			room = null;
			error = res.error.message;
		}
	}

	async function act(path: string, init?: Parameters<typeof api>[1]) {
		busy = true;
		const res = await api(path, { method: 'POST', ...init });
		busy = false;
		if (!res.ok) error = res.error.message;
		else if (slug) void load(slug);
	}

	const isOwner = $derived(room?.role === 'owner');
	const MEDAL_BADGE: Record<string, string> = {
		diesel: '🛢️ Diesel',
		metronome: '🎯 Metronome',
		hammer: '🔨 Hammer',
		lanterne_rouge: '🏮 Lanterne Rouge',
	};
	const isMember = $derived(!!room?.role);
</script>

<main class="mx-auto max-w-2xl px-6 py-10">
	{#if error && !room}
		<div class="mt-16 text-center">
			<Logo size={40} />
			<p class="mt-6 text-sm">{error}</p>
			<a
				href="/rooms"
				class="text-muted mt-3 inline-block text-xs underline hover:text-white"
				>Back to rooms</a
			>
		</div>
	{:else if room}
		<div class="flex items-center gap-3">
			<Logo size={30} />
			<div>
				<h1 class="font-display text-2xl leading-tight font-bold">
					{room.name}
				</h1>
				<p class="text-muted font-mono text-xs">/r/{room.slug}</p>
			</div>
		</div>

		{#if error}
			<p class="border-z6/40 bg-z6/10 mt-4 rounded-lg border px-4 py-3 text-sm">
				{error}
			</p>
		{/if}

		{#if !isMember}
			<!-- The golden path: someone opened a shared link. One decision, one button. -->
			<div
				class="border-muted/15 bg-surface-raised mt-8 rounded-lg border px-6 py-8 text-center"
			>
				{#if !account.loaded}
					<p class="text-muted text-sm">Loading…</p>
				{:else if account.me}
					<p class="text-sm">You have been invited to ride here.</p>
					<button
						onclick={() => act(`/api/rooms/${room?.slug}/join`)}
						disabled={busy}
						class="mt-5 rounded bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-40"
						>Join {room.name}</button
					>
				{:else}
					<p class="text-sm">Sign in to join {room.name}.</p>
					<a
						href="/profile"
						class="mt-5 inline-block rounded bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-white/90"
						>Sign in</a
					>
				{/if}
			</div>
		{:else}
			<div
				class="border-muted/15 bg-surface-raised mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-5 py-4"
			>
				{#if (room.streakWeeks ?? 0) > 0 || (room.monthKj ?? 0) > 0}
					<div>
						<span class="text-muted text-[10px] tracking-wider uppercase"
							>crew streak</span
						>
						<p class="font-display text-sm font-bold">
							{room.streakWeeks} wk · {((room.monthKj ?? 0) / 1000).toFixed(1)} MJ
							this month
						</p>
					</div>
				{/if}
				<div>
					<span class="text-muted text-[10px] tracking-wider uppercase"
						>invite link</span
					>
					<p class="font-mono text-sm select-all">
						{page.url.origin}/r/{room.slug}
					</p>
				</div>
				<div>
					<span class="text-muted text-[10px] tracking-wider uppercase"
						>code</span
					>
					<p class="font-mono text-sm tracking-[0.3em] select-all">
						{room.code}
					</p>
				</div>
			</div>

			<!-- Keyed: a different room is a different socket, not a prop change. -->
			{#key room.slug}
				<RoomLive
					slug={room.slug}
					role={room.role ?? 'member'}
					roomName={room.name}
				/>
			{/key}

			<a
				href="/r/{room.slug}/watch"
				class="text-muted mt-4 inline-block text-xs underline hover:text-white"
				>Watch on a phone (read-only)</a
			>

			{#if room.medals && room.medals.length > 0}
				<h2 class="text-muted mt-8 text-[10px] tracking-wider uppercase">
					Medals
				</h2>
				<ul class="mt-2 flex flex-wrap gap-2">
					{#each room.medals as medal, i (i)}
						<li
							class="border-muted/15 bg-surface-raised rounded-full border px-3 py-1.5 text-xs"
						>
							{MEDAL_BADGE[medal.kind] ?? medal.kind} · {medal.rider}
							<span class="text-muted">· {medal.awardedAt}</span>
						</li>
					{/each}
				</ul>
			{/if}

			<h2 class="text-muted mt-8 text-[10px] tracking-wider uppercase">
				Members
			</h2>
			<ul class="mt-2 grid gap-2">
				{#each room.members ?? [] as member (member.id)}
					<li
						class="border-muted/15 bg-surface-raised flex items-center gap-3 rounded-lg border px-5 py-3"
					>
						<span class="font-medium">{member.displayName}</span>
						<span class="text-muted text-[10px] tracking-wider uppercase"
							>{member.role}</span
						>
						{#if isOwner && member.role !== 'owner'}
							<div class="ml-auto flex gap-2">
								<button
									onclick={() =>
										act(`/api/rooms/${room?.slug}/role`, {
											json: {
												userId: member.id,
												role: member.role === 'coach' ? 'member' : 'coach',
											},
										})}
									disabled={busy}
									class="border-muted/30 hover:border-muted/60 rounded border px-3 py-1.5 text-xs disabled:opacity-40"
									>{member.role === 'coach' ? 'Demote' : 'Make coach'}</button
								>
								<button
									onclick={() =>
										act(`/api/rooms/${room?.slug}/members/${member.id}`, {
											method: 'DELETE',
										})}
									disabled={busy}
									class="border-z6/40 text-z6 hover:bg-z6/10 rounded border px-3 py-1.5 text-xs disabled:opacity-40"
									>Remove</button
								>
							</div>
						{/if}
					</li>
				{/each}
			</ul>

			{#if isOwner}
				<label class="text-muted mt-6 flex items-center gap-2 text-xs">
					<input
						type="checkbox"
						checked={room.listed}
						onchange={(e) =>
							act(`/api/rooms/${room?.slug}`, {
								method: 'PATCH',
								json: {
									name: room?.name ?? '',
									listed: e.currentTarget.checked,
								},
							})}
					/>
					List this room in the public directory
				</label>
			{:else}
				<button
					onclick={() => {
						const myID = account.me?.id;
						if (myID)
							void act(`/api/rooms/${room?.slug}/members/${myID}`, {
								method: 'DELETE',
							});
					}}
					disabled={busy}
					class="text-muted mt-6 text-xs underline hover:text-white disabled:opacity-40"
					>Leave this room</button
				>
			{/if}

			<!-- The live dashboard (ticks, timer, ride) is #18 — this screen is the
			     durable room: who is in it and how to invite the next person. -->
		{/if}
	{/if}
</main>
