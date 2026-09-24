<script lang="ts">
	// One rider's card (#2739). It draws what the app already knows about them
	// at once — the faces every feed teaches — and fills in where they are from
	// their page's own read, whose gate it keeps: a rider you may not open
	// shows no whereabouts.
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Smile from '@lucide/svelte/icons/smile';
	import User from '@lucide/svelte/icons/user';
	import { account } from '$lib/account.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { dm } from '$lib/dm/dm.svelte';
	import { levelFromXp } from '$lib/level';
	import { people } from '$lib/people.svelte';
	import { fetchRider, type Rider } from '$lib/rider';
	import StatusMark from '$lib/status-line/StatusMark.svelte';
	import { clearsLabel } from '$lib/status-line/clear-after';
	import { statusEditor } from '$lib/status-line/editor.svelte';
	import { whereabouts } from '$lib/whereabouts';
	import { placeCard, riderCard } from './rider-card.svelte';
	import { cachedRider } from './cache';

	let { id, anchor }: { id: string; anchor: HTMLElement } = $props();

	const face = $derived(people.face(id));
	let rider = $state<Rider | null>(null);
	$effect(() => {
		const who = id;
		const hit = cachedRider(who);
		if (hit) {
			rider = hit;
			return;
		}
		void fetchRider(who).then((res) => {
			if (res.ok && res.data.id === who) rider = cachedRider(who, res.data);
		});
	});

	const you = $derived(id === account.me?.id);
	const name = $derived(rider?.displayName ?? face?.name ?? '');
	const xp = $derived(rider?.totalXp ?? face?.totalXp);
	const line = $derived(
		you ? account.me?.statusLine : (rider?.statusLine ?? face?.statusLine),
	);
	const where = $derived(rider ? whereabouts(rider.presence) : '');

	let box = $state<HTMLDivElement | null>(null);
	const place = $derived.by(() => {
		const at = anchor.getBoundingClientRect();
		return placeCard(at, box?.offsetHeight ?? 180, {
			width: innerWidth,
			height: innerHeight,
		});
	});
</script>

<!-- Not a modal and not in the tab order: everything here is on the rider's
     page, which the face itself opens. -->
<div
	bind:this={box}
	role="dialog"
	aria-label={name}
	tabindex="-1"
	onpointerenter={riderCard.keep}
	onpointerleave={riderCard.leave}
	style:left="{place.left}px"
	style:top="{place.top}px"
	class="panel fixed z-50 w-72 shadow-2xl"
	data-testid="rider-card"
>
	<div class="flex items-center gap-3">
		<Avatar
			{name}
			avatarUrl={rider?.avatarUrl ?? face?.avatarUrl}
			{xp}
			size={48}
		/>
		<div class="min-w-0">
			<p class="truncate font-bold">{name}</p>
			{#if xp !== undefined}
				<p class="text-muted text-xs">level {levelFromXp(xp)}</p>
			{/if}
		</div>
	</div>

	{#if line}
		<div class="mt-3 flex min-w-0 text-sm">
			<StatusMark {line} size={16} text />
		</div>
		{#if line.expiresAt}
			<p class="text-muted-dim mt-0.5 text-[11px]">
				{clearsLabel(line.expiresAt)}
			</p>
		{/if}
	{/if}
	{#if where}
		<p class="text-muted mt-2 text-xs">{where}</p>
	{/if}

	<div class="mt-3 flex flex-wrap gap-2">
		{#if rider?.friend === 'accepted'}
			<a
				href="/messages/dm/{id}"
				onclick={() => {
					dm.show(id, name);
					riderCard.close();
				}}
				class="btn btn-secondary btn-xs"><MessageSquare size={13} /> Message</a
			>
		{/if}
		{#if you}
			<button
				onclick={() => {
					riderCard.close();
					statusEditor.show();
				}}
				class="btn btn-secondary btn-xs"
				><Smile size={13} />
				{account.me?.statusLine ? 'Edit status' : 'Set a status'}</button
			>
		{/if}
		<a href="/u/{id}" onclick={riderCard.close} class="btn btn-secondary btn-xs"
			><User size={13} /> Rider page</a
		>
	</div>
</div>
