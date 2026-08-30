<script lang="ts">
	import { goto } from '$app/navigation';
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
		soundPack?: string;
		code?: string;
		role?: string;
		members?: Member[];
		medals?: Medal[];
		streakWeeks?: number;
		monthKj?: number;
		upcoming?: {
			id: string;
			workoutName: string;
			workoutJson: string;
			startsAt: string;
			createdBy: string;
		}[];
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

	const isMember = $derived(!!room?.role);

	// WATTROOM.md scopes phones as read-only spectators, and the cockpit's
	// core (pair + ride) needs Web Bluetooth a phone browser doesn't have —
	// so a member opening the share link on a phone lands on the watch view
	// (#124). ?full=1 is the escape hatch, linked from the watch footer.
	$effect(() => {
		if (!room || !isMember) return;
		if (page.url.searchParams.has('full')) return;
		if (matchMedia('(max-width: 767px)').matches) {
			void goto(`/r/${room.slug}/watch`, { replaceState: true });
		}
	});
</script>

{#if error && !room}
	<main class="grid min-h-dvh place-items-center px-6">
		<div class="text-center">
			<Logo size={40} />
			<p class="mt-6 text-sm">{error}</p>
			<a
				href="/rooms"
				class="text-muted mt-3 inline-block text-xs underline hover:text-white"
				>Back to rooms</a
			>
		</div>
	</main>
{:else if room && !isMember}
	<!-- The golden path: someone opened a shared link. One decision, one button. -->
	<main class="grid min-h-dvh place-items-center px-6">
		<div
			class="border-muted/15 bg-surface-raised w-full max-w-md rounded-lg border px-6 py-10 text-center"
		>
			<Logo size={40} />
			<h1 class="font-display mt-5 text-2xl font-bold">{room.name}</h1>
			<p class="text-muted mt-2 text-sm">You have been invited to ride here.</p>
			<button
				onclick={() => act(`/api/rooms/${room?.slug}/join`)}
				disabled={busy}
				class="mt-6 rounded bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-40"
				>Join {room.name}</button
			>
			{#if error}<p class="text-z6 mt-4 text-sm">{error}</p>{/if}
		</div>
	</main>
{:else if !room}
	<!-- Loading: a page never renders blank (.claude/rules/errors.md) — a cold
	     server takes seconds and the void read as broken. -->
	<main class="grid min-h-dvh place-items-center px-6">
		<div class="text-center" aria-busy="true">
			<Logo size={40} />
			<p class="text-muted mt-4 text-sm">Opening the room…</p>
		</div>
	</main>
{:else}
	<!-- A member's room IS the app: full viewport, rail | main | panel (#39). -->
	{#key room.slug}
		<RoomLive
			slug={room.slug}
			role={room.role ?? 'member'}
			roomName={room.name}
			code={room.code ?? ''}
			soundPack={room.soundPack ?? 'base'}
			members={room.members ?? []}
			medals={room.medals ?? []}
			streakWeeks={room.streakWeeks ?? 0}
			monthKj={room.monthKj ?? 0}
			upcoming={room.upcoming ?? []}
			onSchedule={(workoutName, workoutJson, startsAt) =>
				act(`/api/rooms/${room?.slug}/schedule`, {
					json: { workoutName, workoutJson, startsAt },
				})}
			onUnschedule={(id) =>
				act(`/api/rooms/${room?.slug}/schedule/${id}`, { method: 'DELETE' })}
			adminBusy={busy}
			onRole={(userId, nextRole) =>
				act(`/api/rooms/${room?.slug}/role`, {
					json: { userId, role: nextRole },
				})}
			onRemove={(userId) =>
				act(`/api/rooms/${room?.slug}/members/${userId}`, { method: 'DELETE' })}
		/>
	{/key}
{/if}
