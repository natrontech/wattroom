<script lang="ts">
	// Discord's voice-connected panel (#446): you are standing in a room but
	// looking at something else — Training, Home, a message — and the people
	// with you stay bottom-left, above you. The Lounge already shows everyone
	// in tiles, so the strip stays off it; everywhere else this is the only
	// place a face appears off-room, and it carries the whole crew.
	import { SvelteMap } from 'svelte/reactivity';
	import Avatar from '$lib/components/Avatar.svelte';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import { account } from '$lib/account.svelte';
	import { roomConnection } from '$lib/room/connection.svelte';
	import {
		MARK_SURFACE,
		MUTED_MARK,
		tileFrame,
		VOICE_DOT,
	} from '$lib/room/presence-marks';
	import { STRIP_MAX, orderBySpoke } from './room-strip';
	import { MicOff } from '@lucide/svelte';

	let { pathname }: { pathname: string } = $props();

	const conn = $derived(roomConnection.current);
	const onLounge = $derived(!!conn && pathname === `/r/${conn.slug}`);
	const others = $derived(
		(conn?.live.tick?.roster ?? []).filter((r) => r.id !== account.me?.id),
	);

	// Who spoke last, first. Stamped on the rising edge only, so someone who
	// has been talking for a minute does not keep leapfrogging the person who
	// just answered them. The map is written here and read by the derived
	// below — never both in one effect.
	const lastSpoke = new SvelteMap<string, number>();
	let wasSpeaking: Record<string, boolean> = {};
	$effect(() => {
		const speaking = conn?.av.speaking ?? {};
		const now = performance.now();
		for (const [id, on] of Object.entries(speaking))
			if (on && !wasSpeaking[id]) lastSpoke.set(id, now);
		// A snapshot, not the store's proxy — the next run compares, it does
		// not subscribe to an object the store has already replaced.
		wasSpeaking = { ...speaking };
	});
	const ordered = $derived(orderBySpoke(others, lastSpoke));
	const shown = $derived(ordered.slice(0, STRIP_MAX));
	const more = $derived(ordered.length - shown.length);
</script>

{#if conn && !onLounge && others.length > 0}
	{@const av = conn.av}
	{@const metrics = conn.live.tick?.riders ?? {}}
	<div class="border-ink/5 border-t px-3 pt-2.5 pb-1.5">
		<div class="eyebrow flex items-center pb-1.5">
			with you
			<span class="ml-auto font-mono tracking-normal">{others.length}</span>
		</div>
		<div class="grid grid-cols-2 gap-1.5">
			{#each shown as rider (rider.id)}
				{@const video = av.videoOf[rider.id]}
				{@const riding = (metrics[rider.id]?.watts ?? 0) > 0}
				<!-- A tile is the way back to the Lounge — and at the sidebar's
				     width it is already a thumb-sized target (ux.md). The marks
				     are the Lounge tile's own (presence-marks.ts, #505): one way
				     to say speaking, in voice, muted and riding, at half the
				     size. -->
				<a
					href="/r/{conn.slug}"
					title="{rider.name} · back to the Lounge"
					class="bg-surface-raised relative block aspect-[16/10] overflow-hidden rounded {tileFrame(
						!!av.speaking[rider.id],
					)}"
				>
					{#if video}
						{#key video}
							<div
								class="absolute inset-0"
								{@attach (node) => av.attach(rider.id, node)}
							></div>
						{/key}
					{:else}
						<div class="absolute inset-0 grid place-items-center pb-3">
							<Avatar name={rider.name} size={28} />
						</div>
					{/if}
					<span
						class="{MARK_SURFACE} absolute inset-x-0 bottom-0 flex items-center gap-1 px-1 py-px text-[9px]"
					>
						<span class="truncate">{rider.name}</span>
						{#if av.voice[rider.id] === 'muted'}
							<MicOff size={10} class={MUTED_MARK} />
						{:else if av.voice[rider.id] === 'live'}
							<span
								class="{VOICE_DOT} ml-auto"
								title="in voice"
								aria-label="in voice"
							></span>
						{/if}
					</span>
					{#if riding}
						<!-- Riding is motion, never a dot (ADR-0020). -->
						<span
							class="{MARK_SURFACE} absolute top-1 right-1 rounded-full px-1 py-0.5"
						>
							<RidingBars size={8} />
						</span>
					{/if}
				</a>
			{/each}
		</div>
		{#if more > 0}
			<p class="text-muted/70 pt-1 text-[10px]">+{more} more</p>
		{/if}
	</div>
{/if}
