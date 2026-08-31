<script lang="ts">
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import { onDestroy } from 'svelte';
	import { page } from '$app/state';
	import Logo from '$lib/brand/Logo.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { fillPct, ZONE_BG, zoneOf } from '$lib/components/zones';
	import { formatClock, wkg } from '$lib/format';
	import CheerLayer from '$lib/room/CheerLayer.svelte';
	import JamCard from '$lib/room/JamCard.svelte';
	import { api } from '$lib/api';
	import { createRoomLive } from '$lib/room/live.svelte';
	import { parseSharedSegments } from '$lib/room/workout';

	// The phone spectator (#20): read-only, any mobile browser — iOS Safari is
	// the whole point, since Web Bluetooth will never exist there. No BLE, no
	// publishing, and per the roles matrix nothing to press yet (cheers land
	// with their own issue).

	// Keyed remount per slug is unnecessary here — the page is a leaf.
	// svelte-ignore state_referenced_locally
	const live = createRoomLive(page.params.slug ?? '');

	// The room's reaction palette (#223) — the spectator speaks the room's
	// vocabulary too. Base set until the fetch lands.
	let cheers = $state(['🔥', '💪', '👏', '💀']);
	void api<{ cheers?: string[] }>(`/api/rooms/${page.params.slug}`).then(
		(res) => {
			if (res.ok && res.data.cheers?.length) cheers = res.data.cheers;
		},
	);
	let draft = $state('');
	function sendChat() {
		const text = draft.trim();
		if (!text) return;
		draft = '';
		live.chat(text);
	}
	onDestroy(() => live.close());

	const shared = $derived(live.tick?.state);
	const running = $derived(
		shared?.phase === 'running' ||
			shared?.phase === 'paused' ||
			shared?.phase === 'countdown',
	);
	const segments = $derived(parseSharedSegments(shared?.workoutJson));

	// Ranked by %FTP, the fair ordering for mixed groups — same rule as every
	// contest in docs/SPEC.md.
	const ranked = $derived(
		(live.tick?.roster ?? [])
			.map((rider) => ({
				...rider,
				metrics: live.tick?.riders?.[rider.id],
			}))
			.sort(
				(a, b) =>
					(b.metrics?.watts ?? 0) / Math.max(1, b.ftpWatts) -
					(a.metrics?.watts ?? 0) / Math.max(1, a.ftpWatts),
			),
	);
</script>

<div class="cave bg-surface text-ink flex min-h-dvh flex-col">
	<header class="border-ink/5 flex items-center gap-2.5 border-b px-4 py-3">
		<Logo size={22} live={shared?.phase === 'running'} />
		<div class="min-w-0">
			<p class="truncate text-sm font-medium">/r/{page.params.slug}</p>
			<p class="text-muted truncate text-[11px]">
				{#if live.status !== 'live'}
					{live.status === 'connecting'
						? 'connecting…'
						: 'connection lost — reconnecting…'}
				{:else if shared?.phase === 'countdown'}
					{shared.workoutName} starts in {shared.countdownRemaining}…
				{:else if running}
					{shared?.workoutName}{shared?.phase === 'paused' ? ' · paused' : ''}
				{:else}
					in the lounge
				{/if}
			</p>
		</div>
		{#if running && shared}
			<span
				class="font-display ml-auto text-lg leading-none font-bold tabular-nums"
				>{formatClock(shared.elapsed)}</span
			>
		{/if}
	</header>

	{#if running}
		<ul class="flex-1 overflow-y-auto">
			{#each ranked as rider (rider.id)}
				{@const watts = rider.metrics?.watts ?? 0}
				{@const zone = zoneOf(watts, rider.ftpWatts)}
				<li class="border-ink/5 border-b px-4 py-2.5">
					<div class="flex items-baseline gap-2">
						<span class="truncate text-sm">{rider.name}</span>
						{#if rider.role !== 'member'}
							<span class="eyebrow">{rider.role}</span>
						{/if}
						<span
							class="font-display ml-auto text-2xl leading-none font-bold tabular-nums"
							>{watts}</span
						>
						<span class="text-muted text-[10px]">W</span>
					</div>
					<div class="mt-1.5 flex items-center gap-2">
						<ProgressBar
							pct={fillPct(watts, rider.ftpWatts)}
							fill="{ZONE_BG[zone]} transition-[width] duration-500"
							class="flex-1"
						/>
						<span
							class="text-muted w-16 text-right font-mono text-[10px] tabular-nums"
							>{wkg(watts, rider.weightKg)} w/kg</span
						>
					</div>
				</li>
			{:else}
				<li class="text-muted px-4 py-6 text-center text-xs">
					Nobody is connected right now.
				</li>
			{/each}
		</ul>

		{#if segments.length > 0 && shared}
			<div class="border-ink/5 border-t">
				<IntervalGraph
					{segments}
					total={shared.totalSeconds ?? 0}
					elapsed={shared.elapsed}
					ftp={ranked[0]?.ftpWatts ?? 200}
					trace={[]}
					compact
				/>
			</div>
		{/if}
	{:else}
		<!-- Empty states teach, never apologise (.claude/rules/ux.md). -->
		<div
			class="flex flex-1 flex-col items-center justify-center px-8 text-center"
		>
			<Logo size={48} />
			<p class="mt-5 text-sm">Nobody's riding yet.</p>
			<p class="text-muted mt-2 text-xs leading-relaxed">
				You'll see everyone's live power here the moment the coach starts the
				session.
			</p>
		</div>
	{/if}

	<!-- The spectator's one verb (roles matrix). One-handed, often standing. -->
	<div class="border-ink/5 border-t p-3">
		<div class="flex gap-2">
			{#each cheers.slice(0, 4) as emoji (emoji)}
				<button
					onclick={() => live.cheer(emoji)}
					class="border-muted/20 active:bg-surface-raised flex-1 rounded-lg border py-4 text-2xl"
					>{emoji}</button
				>
			{/each}
		</div>
		<p class="text-muted mt-2 text-center text-[10px]">
			Spectating — cheers land in the room. Bring a laptop to ride.
			<a href="/r/{page.params.slug}?full=1" class="hover:text-ink underline"
				>Riding on this device anyway?</a
			>
		</p>
		{#if live.chatLog.length > 0}
			<ul class="mt-3 max-h-28 space-y-1 overflow-y-auto">
				{#each live.chatLog.slice(-8) as message (message.at + message.from)}
					<li class="text-xs leading-snug">
						<span class="text-muted font-medium">{message.from}</span>
						<span class="text-ink/85 ml-1.5">{message.text}</span>
					</li>
				{/each}
			</ul>
		{/if}
		<form
			class="mt-2 flex gap-1.5"
			onsubmit={(e) => {
				e.preventDefault();
				sendChat();
			}}
		>
			<input
				bind:value={draft}
				maxlength="500"
				placeholder="Say something…"
				class="input min-w-0 flex-1"
			/>
			<button disabled={!draft.trim()} class="btn btn-secondary">Send</button>
		</form>
		{#if live.tick?.jukebox?.jamUrl}
			<div class="mt-3">
				<JamCard jamUrl={live.tick.jukebox.jamUrl} />
			</div>
		{/if}
	</div>
	<CheerLayer cheers={live.tick?.cheers} />
</div>
