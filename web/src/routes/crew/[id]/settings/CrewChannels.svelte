<script lang="ts">
	// The crew's channels (ADR-0058, #2454): text ones and voice ones, each in
	// its own order, and the forms that add one. Channels have no owner — the
	// crew's owner and admins keep all of them, which is who reaches this page.
	import Banner from '$lib/components/Banner.svelte';
	import {
		createChannel,
		fetchCrewChannels,
		updateChannel,
		type CrewChannel,
		type ChannelKind,
	} from '$lib/channels';
	import type { Crew } from '$lib/crew';
	import {
		MaxChannelNameChars,
		MaxCrewTextChannels,
		MaxCrewVoiceChannels,
	} from '$lib/protocol';
	import { createPlaylistStore } from '$lib/channel/playlists.svelte';
	import { toasts } from '$lib/toast.svelte';
	import ChannelRow from './ChannelRow.svelte';

	let { crew }: { crew: Crew } = $props();

	let channels = $state<CrewChannel[] | null>(null);
	let error = $state<string | null>(null);
	// The crew's shelf, once for every voice channel's autoplay picker.
	const playlists = $derived(
		createPlaylistStore(`/api/crews/${crew.id}/playlists`),
	);

	async function load() {
		const res = await fetchCrewChannels(crew.id);
		if (res.ok) {
			channels = res.data.channels;
			error = null;
		} else error = res.error.message;
	}
	$effect(() => {
		void crew.id;
		void load();
	});

	const KINDS = [
		{ kind: 'text', title: 'Chat channels', cap: MaxCrewTextChannels },
		{ kind: 'voice', title: 'Voice channels', cap: MaxCrewVoiceChannels },
	] as const;

	let draft = $state<Record<ChannelKind, string>>({ text: '', voice: '' });
	let createError = $state<Record<ChannelKind, string | null>>({
		text: null,
		voice: null,
	});
	let creating = $state(false);

	async function create(kind: ChannelKind) {
		creating = true;
		const res = await createChannel(crew.id, { kind, name: draft[kind] });
		creating = false;
		if (!res.ok) {
			createError[kind] = res.error.message;
			return;
		}
		draft[kind] = '';
		createError[kind] = null;
		await load();
	}

	async function move(channel: CrewChannel, to: number) {
		const res = await updateChannel(channel.id, { position: Math.max(0, to) });
		if (!res.ok) toasts.push(res.error.message, { tone: 'error' });
		await load();
	}

	// Drag within a kind's list: the row carries its id, the row it lands on
	// its position. The context menu's Move up / Move down is the same move
	// for a keyboard or a touch screen (ux.md: never the only way).
	let dragging = $state<CrewChannel | null>(null);
</script>

<section class="panel panel-xl mt-5">
	<h2 class="font-display font-bold">Channels</h2>
	<p class="text-muted mt-1.5 text-xs">
		Chats are where the crew writes; voice channels are where it talks, plays
		music and rides. Drag a channel to reorder it, or right-click it.
	</p>

	{#if error && !channels}
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
	{:else if !channels}
		<p class="text-muted mt-3 text-xs">Loading the channels…</p>
	{:else}
		{#each KINDS as group (group.kind)}
			{@const list = channels.filter((c) => c.kind === group.kind)}
			{@const full = list.length >= group.cap}
			<h3 class="eyebrow mt-5">{group.title}</h3>
			{#if list.length > 0}
				<ul class="divide-ink/5 panel panel-flush mt-2 divide-y">
					{#each list as channel, i (channel.id)}
						<li
							draggable="true"
							ondragstart={() => (dragging = channel)}
							ondragend={() => (dragging = null)}
							ondragover={(e) => {
								if (dragging?.kind === channel.kind) e.preventDefault();
							}}
							ondrop={(e) => {
								e.preventDefault();
								const moved = dragging;
								dragging = null;
								if (moved && moved.id !== channel.id) void move(moved, i);
							}}
							class={dragging?.id === channel.id ? 'opacity-50' : ''}
						>
							<ChannelRow
								{channel}
								people={crew.people}
								{playlists}
								first={i === 0}
								last={i === list.length - 1}
								onchange={load}
								onmove={(to) => void move(channel, to)}
							/>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-muted mt-2 text-xs">
					{group.kind === 'text'
						? 'No chats — the crew has nowhere to write.'
						: 'No voice channels — the crew has nowhere to talk or ride.'}
				</p>
			{/if}
			<form
				class="mt-2 flex flex-wrap items-start gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					void create(group.kind);
				}}
			>
				<input
					bind:value={draft[group.kind]}
					maxlength={MaxChannelNameChars}
					disabled={full}
					class="input min-w-0 flex-1"
					placeholder="New {group.kind} channel"
					aria-label="new {group.kind} channel name"
				/>
				<button
					disabled={creating || full || !draft[group.kind].trim()}
					class="btn btn-secondary btn-sm">Add</button
				>
			</form>
			{#if full}
				<p class="text-muted mt-1.5 text-xs">
					A crew holds at most {group.cap}
					{group.kind} channels — delete one to make room.
				</p>
			{:else if createError[group.kind]}
				<p class="text-danger mt-1.5 text-xs">{createError[group.kind]}</p>
			{/if}
		{/each}
	{/if}
</section>
