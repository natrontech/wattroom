<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Logo from '$lib/brand/Logo.svelte';
	import { account } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import RoomShell from '$lib/room/RoomShell.svelte';

	interface Member {
		id: string;
		displayName: string;
		avatarUrl?: string;
		avatarPreset?: string;
		role: string;
		totalXp?: number;
		ftpWatts?: number;
		weightKg?: number;
		joinedAt?: string;
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
		icon?: string;
		cheers?: string[];
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
		icsToken?: string;
	}

	let { children } = $props();

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
	// Decided SYNCHRONOUSLY: rendering RoomLive first opened a second,
	// unleavable socket before the redirect landed (#219).
	const phoneSpectator =
		typeof window !== 'undefined' &&
		!page.url.searchParams.has('full') &&
		matchMedia('(max-width: 767px)').matches;
	$effect(() => {
		if (!room || !isMember || !phoneSpectator) return;
		void goto(`/r/${room.slug}/watch`, { replaceState: true });
	});
</script>

{#if error && !room}
	<main class="grid min-h-full place-items-center px-6">
		<div class="text-center">
			<Logo size={40} />
			<p class="mt-6 text-sm">{error}</p>
			<a
				href="/home"
				class="text-muted hover:text-ink mt-3 inline-block text-xs underline"
				>Back to your rooms</a
			>
		</div>
	</main>
{:else if room && !isMember}
	<!-- The golden path: someone opened a shared link. One decision, one button. -->
	<main class="grid min-h-full place-items-center px-6">
		<div class="panel w-full max-w-md px-6 py-10 text-center">
			<Logo size={40} />
			<h1 class="font-display mt-5 text-2xl font-bold">{room.name}</h1>
			<p class="text-muted mt-2 text-sm">You have been invited to ride here.</p>
			<button
				onclick={() => act(`/api/rooms/${room?.slug}/join`)}
				disabled={busy}
				class="btn btn-primary btn-lg mt-6">Join {room.name}</button
			>
			{#if error}<p class="text-danger mt-4 text-sm">{error}</p>{/if}
			<!-- Privacy is architecture (WATTROOM.md): say what the room sees
			     before the button, not in a policy page after it. -->
			<p class="text-muted/70 mt-4 text-[11px]">
				Your watts are visible to this room while you ride here, and nowhere
				else.
			</p>
		</div>
	</main>
{:else if !room}
	<!-- Loading: a page never renders blank (.claude/rules/errors.md) — a cold
	     server takes seconds and the void read as broken. -->
	<main class="grid min-h-full place-items-center px-6">
		<div class="text-center" aria-busy="true">
			<Logo size={40} />
			<p class="text-muted mt-4 text-sm">Opening the room…</p>
		</div>
	</main>
{:else}
	<!-- A member's room IS the app. The shell owns the connection, the AV and
	     the ride; the place standing in it is the child route (ADR-0020). -->
	{#key room.slug}
		<!-- The places carry no visible room title — the sidebar names the room
		     you are standing in (ADR-0020) — so the page's heading is for
		     assistive tech: which room this is. -->
		<h1 class="sr-only">{room.name}</h1>
		{#if phoneSpectator}
			<!-- redirecting to the watch view -->
		{:else}
			<RoomShell
				slug={room.slug}
				role={room.role ?? 'member'}
				roomName={room.name}
				icon={room.icon ?? ''}
				cheers={room.cheers}
				code={room.code ?? ''}
				soundPack={room.soundPack ?? 'base'}
				members={room.members ?? []}
				medals={room.medals ?? []}
				streakWeeks={room.streakWeeks ?? 0}
				monthKj={room.monthKj ?? 0}
				upcoming={room.upcoming ?? []}
				onSchedule={(
					workoutName: string,
					workoutJson: string,
					startsAt: string,
				) =>
					act(`/api/rooms/${room?.slug}/schedule`, {
						json: { workoutName, workoutJson, startsAt },
					})}
				onReschedule={(id: string, startsAt: string) =>
					act(`/api/rooms/${room?.slug}/schedule/${id}`, {
						method: 'PATCH',
						json: { startsAt },
					})}
				onUnschedule={(id: string) =>
					act(`/api/rooms/${room?.slug}/schedule/${id}`, { method: 'DELETE' })}
				icsToken={room.icsToken ?? ''}
				onRotateIcs={() => act(`/api/rooms/${room?.slug}/calendar/rotate`)}
				adminBusy={busy}
				onRole={(userId: string, nextRole: string) =>
					act(`/api/rooms/${room?.slug}/role`, {
						json: { userId, role: nextRole },
					})}
				onRemove={(userId: string) =>
					act(`/api/rooms/${room?.slug}/members/${userId}`, {
						method: 'DELETE',
					})}
			>
				{@render children()}
			</RoomShell>
		{/if}
	{/key}
{/if}
