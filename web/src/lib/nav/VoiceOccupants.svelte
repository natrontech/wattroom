<script lang="ts">
	// Who is in one voice channel, under its sidebar row (#438, #2702): one
	// line of names while folded, one rider per line with their status and
	// states while unfolded (#2745). Names are also what an admin drags to
	// move a rider (#2730), so arrivals and departures glide rather than jump.
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import { slide } from 'svelte/transition';
	import RidingBars from '$lib/components/RidingBars.svelte';
	import { contextMenu } from '$lib/context-menu.svelte';
	import type { LiveChannel } from '$lib/crews-live';
	import StatusMark from '$lib/status-line/StatusMark.svelte';
	import { AWAY_STATES } from '$lib/away';
	import Headphones from '@lucide/svelte/icons/headphones';
	import Video from '@lucide/svelte/icons/video';
	import { railPeople } from './rail-people';
	import type { VoiceMover } from './voice-mover.svelte';
	import { reducedMotion } from '$lib/motion';

	let {
		channel,
		open,
		mover,
	}: { channel: LiveChannel; open: boolean; mover: VoiceMover } = $props();

	const list = $derived(mover.occupants(channel));
	const people = $derived(railPeople(list.map((o) => o.name)));
	const inVoice = $derived(list.some((o) => o.voice));
	const Away = AWAY_STATES[''].icon;

	// Motion is the landing's feedback, never its meaning: with reduced motion
	// the name is simply there.
	const glide = (node: Element, axis: 'x' | 'y') =>
		slide(node, {
			axis,
			duration: reducedMotion() ? 0 : 200,
			easing: cubicOut,
		});
	const settle = () => ({ duration: reducedMotion() ? 0 : 200 });
</script>

{#if open}
	<!-- Labelled only while it lists somebody: the last rider out glides away
	     in a list that is still here, and an empty one reads as nothing. -->
	<ul
		aria-label={list.length ? `Who is in ${channel.name}` : undefined}
		class={list.length ? 'pb-1' : ''}
	>
		{#each list as o (o.id)}
			{@const grab = mover.grab(channel, o)}
			<li
				{...grab}
				{@attach contextMenu(() => mover.menu(channel, o))}
				in:glide={'y'}
				out:glide={'y'}
				animate:flip={settle()}
				class:landed={mover.landed(channel, o)}
				class:opacity-40={mover.dragging?.rider === o.id}
				class:opacity-60={mover.inFlight(o.id)}
				class="text-muted flex items-center gap-1.5 rounded px-2 py-0.5 pl-8 text-xs transition-opacity duration-150 motion-reduce:transition-none {grab.draggable
					? 'cursor-grab active:cursor-grabbing'
					: ''}"
			>
				<span class="min-w-0 shrink truncate {o.away ? 'opacity-60' : ''}"
					>{o.name}</span
				>
				<span class="text-muted-dim min-w-0 flex-1 truncate">
					<StatusMark line={o.statusLine} size={11} text />
				</span>
				{#if o.away}<Away size={11} class="shrink-0" aria-label="away" />{/if}
				{#if o.riding}<span class="text-watt shrink-0"
						><RidingBars size={9} /></span
					>{/if}
				{#if o.camera}<Video
						size={11}
						class="shrink-0"
						aria-label="camera on"
					/>{/if}
				{#if o.voice}<Headphones
						size={11}
						class="shrink-0"
						aria-label="in voice"
					/>{/if}
			</li>
		{/each}
	</ul>
{:else}
	<!-- Who is in there, without going in (#438): one line of names, each
	     with its status emoji (ADR-0060) — the emoji's title holds the words,
	     the line's the whole list. Drawn even while empty, so the last name
	     out can still glide away. -->
	<p
		class="text-muted-dim flex items-center gap-1 truncate px-2 pl-8 text-[10px] {list.length
			? 'pb-1'
			: ''}"
	>
		{#if inVoice}<Headphones size={9} class="shrink-0" />{/if}
		<span class="flex min-w-0 items-center truncate" title={people.label}>
			{#each list.slice(0, people.shown.length) as o, i (o.id)}
				<span
					in:glide={'x'}
					out:glide={'x'}
					animate:flip={settle()}
					class:landed={mover.landed(channel, o)}
					class:opacity-40={mover.dragging?.rider === o.id}
					class:opacity-60={mover.inFlight(o.id)}
					class="flex min-w-0 items-center rounded transition-opacity duration-150 motion-reduce:transition-none"
				>
					{#if i > 0}<span class="shrink-0">,&nbsp;</span>{/if}
					<span
						{...mover.grab(channel, o)}
						{@attach contextMenu(() => mover.menu(channel, o))}
						class="truncate">{o.name}</span
					>
					<StatusMark line={o.statusLine} size={9} />
				</span>
			{/each}
			{#if people.more > 0}<span class="shrink-0">&nbsp;+{people.more}</span
				>{/if}
		</span>
	</p>
{/if}

<style>
	/* Where a dropped name came down: chrome, so neon, and a wash that fades
	   rather than a glow (ADR-0005 — only live data glows). */
	.landed {
		animation: landed 1.4s ease-out;
	}
	@keyframes landed {
		from {
			background-color: color-mix(in srgb, var(--color-neon) 28%, transparent);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.landed {
			animation: none;
		}
	}
</style>
