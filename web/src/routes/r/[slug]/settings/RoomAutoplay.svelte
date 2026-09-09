<script lang="ts">
	import Banner from '$lib/components/Banner.svelte';
	import ListOrdered from '@lucide/svelte/icons/list-ordered';
	import Shuffle from '@lucide/svelte/icons/shuffle';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Select from '$lib/components/Select.svelte';
	import { toasts } from '$lib/toast.svelte';
	import {
		createPlaylistStore,
		getAutoplay,
		updateAutoplay,
		type AutoplaySettings,
	} from '$lib/room/playlists.svelte';

	// Autoplay is a room setting (#1422): the switch, the order and which room
	// playlist it walks live here beside the room's other settings, not in the
	// jukebox column a rider scans mid-ride. The coach and the owner change it
	// (SPEC roles matrix, #771); everyone else reads it. Saved on every
	// change with the full local state, like the room settings around it.
	let { slug, canManage }: { slug: string; canManage: boolean } = $props();

	let autoplay = $state<AutoplaySettings | null>(null);
	let error = $state<string | null>(null);
	let saving = $state(false);
	const playlists = $derived.by(() =>
		createPlaylistStore(`/api/rooms/${slug}/playlists`),
	);

	$effect(() => {
		if (slug) void load();
	});

	async function load() {
		const res = await getAutoplay(slug);
		if (res.ok) {
			autoplay = res.data ?? null;
			error = null;
		} else {
			autoplay = null;
			error = res.error.message;
		}
	}

	async function save(next: Partial<AutoplaySettings>) {
		if (!autoplay) return;
		const merged = { ...autoplay, ...next };
		saving = true;
		const res = await updateAutoplay(slug, merged);
		saving = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		autoplay = res.data ?? merged;
		void playlists.refresh();
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
			hint: "The active playlist's library tracks, drawn by this room's taste: quietest on what it just played or keeps skipping, matched to the cadence a running session asks for. With no playlist, the members' whole libraries.",
		},
	] as const;
</script>

<section class="panel mt-3 p-6">
	<h2 class="font-display font-bold">Autoplay</h2>
	<p class="text-muted mt-1.5 text-xs">
		Plays something whenever the deck is idle: when someone joins, and again
		each time it runs out. It never interrupts what the room is already hearing.
		{#if !canManage}Only the room's coach or owner can change it.{/if}
	</p>

	{#if error && !autoplay}
		<div class="mt-3">
			<Banner tone="error">
				{error}
				{#snippet action()}
					<button onclick={() => void load()} class="btn-link text-xs"
						>Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{:else if autoplay}
		<label
			class="mt-3 flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 {autoplay.enabled
				? 'border-ink/40'
				: 'border-muted/15'}"
		>
			<input
				type="checkbox"
				checked={autoplay.enabled}
				onchange={() => save({ enabled: !autoplay?.enabled })}
				disabled={saving || !canManage}
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

		<div class="mt-3 grid gap-2" role="radiogroup" aria-label="autoplay order">
			{#each ORDERS as choice (choice.key)}
				<button
					role="radio"
					aria-checked={autoplay.order === choice.key}
					onclick={() => save({ order: choice.key })}
					disabled={saving || !canManage}
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

		<div class="mt-3">
			<span class="eyebrow">active playlist</span>
			<div class="mt-1">
				<Select
					label="active playlist"
					disabled={saving || !canManage}
					value={autoplay.activePlaylistId ?? ''}
					options={[
						{ value: '', label: 'None yet' },
						...playlists.all.map((playlist) => ({
							value: playlist.id,
							label: `${playlist.name} · ${playlist.trackCount} ${playlist.trackCount === 1 ? 'track' : 'tracks'}`,
						})),
					]}
					onchange={(activePlaylistId) => save({ activePlaylistId })}
				/>
			</div>
			<span class="text-muted mt-1.5 block text-xs">
				{#if playlists.loaded && playlists.all.length === 0}
					No room playlists yet — the jukebox saves them, under playlists.
				{:else if !autoplay.activePlaylistId}
					{autoplay.order === 'smart'
						? "Without one, Smart draws from the members' whole libraries."
						: 'Ordered and Shuffled need one.'} Pick it here, or from a playlist's
					menu in the jukebox.
				{:else}
					Room playlists are saved in the jukebox, under playlists.
				{/if}
			</span>
		</div>
	{/if}
</section>
