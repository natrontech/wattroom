<script lang="ts">
	import ListOrdered from '@lucide/svelte/icons/list-ordered';
	import Shuffle from '@lucide/svelte/icons/shuffle';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Select from '$lib/components/Select.svelte';
	import { toasts } from '$lib/toast.svelte';
	import {
		updateChannel,
		type CrewChannel,
		type ChannelAutoplay,
	} from '$lib/channels';
	import type { PlaylistStore } from '$lib/room/playlists.svelte';

	// Autoplay is a voice channel's (#1422, ADR-0058): the switch, the order
	// and which of the crew's playlists it walks, kept by the crew's owner and
	// admins beside the channel's other settings, never in the jukebox column
	// a rider scans mid-ride. Saved on every change.
	let {
		channel,
		playlists,
		onsaved,
	}: {
		channel: CrewChannel;
		playlists: PlaylistStore;
		onsaved: (channel: CrewChannel) => void;
	} = $props();

	const autoplay = $derived<ChannelAutoplay>(
		channel.autoplay ?? { enabled: false, order: 'ordered' },
	);
	let saving = $state(false);

	async function save(next: Partial<ChannelAutoplay>) {
		saving = true;
		const res = await updateChannel(channel.id, { autoplay: next });
		saving = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		onsaved(res.data);
	}

	const ORDERS = [
		{
			key: 'ordered',
			label: 'Ordered',
			icon: ListOrdered,
			hint: 'The active playlist top to bottom, and round again when it ends.',
		},
		{
			key: 'shuffled',
			label: 'Shuffled',
			icon: Shuffle,
			hint: 'The active playlist in a fresh order each time the deck runs dry.',
		},
		{
			key: 'smart',
			label: 'Smart',
			icon: Sparkles,
			hint: "The active playlist's library tracks, drawn by this channel's taste: quietest on what it just played or keeps skipping, matched to the cadence a running session asks for. With no playlist, the members' whole libraries.",
		},
	] as const;
</script>

<div class="mt-4">
	<span class="eyebrow">autoplay</span>
	<p class="text-muted mt-1 text-xs">
		Plays something whenever the deck is idle: when someone joins, and again
		each time it runs out. It never interrupts what the channel is already
		hearing.
	</p>
	<label
		class="mt-2 flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 {autoplay.enabled
			? 'border-ink/40'
			: 'border-muted/15'}"
	>
		<input
			type="checkbox"
			checked={autoplay.enabled}
			onchange={() => save({ enabled: !autoplay.enabled })}
			disabled={saving}
		/>
		<span class="min-w-0">
			<span class="block text-sm font-medium"
				>{autoplay.enabled ? 'On' : 'Off'}</span
			>
			<span class="text-muted block text-xs">
				{autoplay.enabled
					? 'An idle deck starts itself.'
					: 'An idle deck stays quiet until somebody queues something.'}
			</span>
		</span>
	</label>

	<div
		class="mt-2 grid gap-2"
		role="radiogroup"
		aria-label="autoplay order in {channel.name}"
	>
		{#each ORDERS as choice (choice.key)}
			<button
				role="radio"
				aria-checked={autoplay.order === choice.key}
				onclick={() => save({ order: choice.key })}
				disabled={saving}
				class="flex items-center gap-3 rounded-lg border px-4 py-3 text-left {autoplay.order ===
				choice.key
					? 'border-ink/40'
					: 'border-muted/15'}"
			>
				<choice.icon size={16} class="text-muted shrink-0" />
				<span class="min-w-0">
					<span class="block text-sm font-medium">{choice.label}</span>
					<span class="text-muted block text-xs">{choice.hint}</span>
				</span>
			</button>
		{/each}
	</div>

	<div class="mt-2">
		<Select
			label="active playlist"
			disabled={saving}
			value={autoplay.playlistId ?? ''}
			options={[
				{ value: '', label: 'No playlist' },
				...playlists.all.map((playlist) => ({
					value: playlist.id,
					label: `${playlist.name} · ${playlist.trackCount} ${playlist.trackCount === 1 ? 'track' : 'tracks'}`,
				})),
			]}
			onchange={(playlistId) => save({ playlistId })}
		/>
		<span class="text-muted mt-1.5 block text-xs">
			{#if playlists.loaded && playlists.all.length === 0}
				No crew playlists yet — the jukebox saves them, under playlists.
			{:else if !autoplay.playlistId}
				{autoplay.order === 'smart'
					? "Without one, Smart draws from the members' whole libraries."
					: 'Ordered and Shuffled need one.'}
			{:else}
				The crew's playlists are saved in the jukebox, under playlists.
			{/if}
		</span>
	</div>
</div>
