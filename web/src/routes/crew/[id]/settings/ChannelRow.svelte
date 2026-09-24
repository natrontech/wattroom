<script lang="ts">
	import StatusMark from '$lib/status-line/StatusMark.svelte';
	// One of the crew's channels as its owner and admins keep it (ADR-0058,
	// #2454): its name, its gate and who is named through it, and — for a
	// voice channel — its sounds and its autoplay. Everything saves on
	// change; the list around it owns the order and re-reads after each save.
	import Select from '$lib/components/Select.svelte';
	import {
		deleteChannelWarning,
		deleteChannel,
		deleteLabel,
		setNamedInChannel,
		updateChannel,
		type CrewChannel,
		type ChannelPatch,
	} from '$lib/channels';
	import { confirm } from '$lib/confirm.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import type { CrewPerson } from '$lib/crew';
	import { MaxChannelNameChars } from '$lib/protocol';
	import type { PlaylistStore } from '$lib/channel/playlists.svelte';
	import { toasts } from '$lib/toast.svelte';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import Lock from '@lucide/svelte/icons/lock';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Volume from '@lucide/svelte/icons/volume-2';
	import ChannelAutoplay from './ChannelAutoplay.svelte';

	let {
		channel,
		people,
		playlists,
		first,
		last,
		onchange,
		onmove,
	}: {
		channel: CrewChannel;
		/** The crew's people, for naming a member into a private channel. */
		people: CrewPerson[];
		playlists: PlaylistStore;
		first: boolean;
		last: boolean;
		/** Re-read the list: the row's own read is the list's. */
		onchange: () => Promise<void>;
		/** Move within its kind's list, counted from 0. */
		onmove: (to: number) => void;
	} = $props();

	let busy = $state(false);
	let name = $state('');
	$effect(() => {
		name = channel.name;
	});

	const Icon = $derived(channel.kind === 'voice' ? Volume : MessageCircle);
	const named = $derived(new Set((channel.members ?? []).map((m) => m.id)));
	// The owner and admins enter by role, so only a plain member is named.
	const nameable = $derived(
		people.filter((p) => p.role === 'member' && !named.has(p.id)),
	);

	async function patch(next: ChannelPatch) {
		busy = true;
		const res = await updateChannel(channel.id, next);
		busy = false;
		if (!res.ok) toasts.push(res.error.message, { tone: 'error' });
		await onchange();
	}

	function rename() {
		const next = name.trim();
		if (next === channel.name) return;
		if (!next) {
			name = channel.name;
			return;
		}
		void patch({ name: next });
	}

	async function setNamed(userId: string, on: boolean) {
		busy = true;
		const res = await setNamedInChannel(channel.id, userId, on);
		busy = false;
		if (!res.ok) toasts.push(res.error.message, { tone: 'error' });
		await onchange();
	}

	// Destructive with no undo (errors.md): the channel's history goes with
	// it, for everyone, so the body names exactly what.
	async function remove() {
		const ok = await confirm({
			title: `Delete ${channel.name}?`,
			body: deleteChannelWarning(channel),
			action: deleteLabel(channel.kind),
			cancel: 'Keep it',
		});
		if (!ok) return;
		busy = true;
		const res = await deleteChannel(channel.id);
		busy = false;
		if (!res.ok) toasts.push(res.error.message, { tone: 'error' });
		await onchange();
	}

	function entries(): MenuEntry[] {
		return [
			{
				label: 'Move up',
				icon: ArrowUp,
				disabled: first,
				onSelect: () => onmove(channel.position - 1),
			},
			{
				label: 'Move down',
				icon: ArrowDown,
				disabled: last,
				onSelect: () => onmove(channel.position + 1),
			},
			{
				label: channel.private ? 'Open to the crew' : 'Make private',
				icon: Lock,
				onSelect: () => void patch({ private: !channel.private }),
			},
			'separator',
			{
				label: deleteLabel(channel.kind),
				icon: Trash,
				danger: true,
				onSelect: () => void remove(),
			},
		];
	}
</script>

<details class="group" {@attach contextMenu(entries)}>
	<summary
		title={MENU_HINT}
		class="hover:bg-ink/5 flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden"
	>
		<GripVertical size={14} class="text-muted-dim shrink-0 cursor-grab" />
		<Icon size={15} class="text-muted shrink-0" />
		<span class="min-w-0 flex-1 truncate">{channel.name}</span>
		{#if channel.private}
			<span class="text-muted-dim flex items-center gap-1 text-[11px]"
				><Lock size={12} /> private</span
			>
		{/if}
	</summary>

	<div class="border-ink/5 space-y-4 border-t px-4 py-4">
		<label class="block">
			<span class="eyebrow">name</span>
			<input
				bind:value={name}
				onchange={rename}
				disabled={busy}
				maxlength={MaxChannelNameChars}
				class="input mt-1 w-full"
			/>
		</label>

		<div>
			<label class="flex cursor-pointer items-start gap-3">
				<input
					type="checkbox"
					class="mt-0.5"
					checked={channel.private}
					onchange={() => void patch({ private: !channel.private })}
					disabled={busy}
				/>
				<span class="min-w-0">
					<span class="block text-sm font-medium">Private</span>
					<span class="text-muted block text-xs"
						>Only the crew's owner, its admins and the members named here can
						find it, {channel.kind === 'text'
							? 'read it and write in it'
							: 'hear it and ride in it'}.</span
					>
				</span>
			</label>
			{#if channel.private}
				<ul class="mt-2 space-y-1 pl-7">
					{#each channel.members ?? [] as member (member.id)}
						<li class="flex items-center gap-2 text-sm">
							<span class="flex min-w-0 flex-1 items-center gap-1.5">
								<span class="truncate">{member.displayName}</span>
								<!-- From the crew's people this row is handed — this page
								     does not teach the face cache. -->
								<StatusMark
									line={people.find((p) => p.id === member.id)?.statusLine}
									size={12}
								/>
							</span>
							<button
								onclick={() => void setNamed(member.id, false)}
								disabled={busy}
								class="btn btn-ghost btn-xs">Take out</button
							>
						</li>
					{:else}
						<li class="text-muted text-xs">Nobody named yet.</li>
					{/each}
				</ul>
				{#if nameable.length > 0}
					<div class="mt-2 pl-7">
						<Select
							label="name a member into {channel.name}"
							disabled={busy}
							value=""
							options={[
								{ value: '', label: 'Name a member…' },
								...nameable.map((p) => ({ value: p.id, label: p.displayName })),
							]}
							onchange={(id) => id && void setNamed(id, true)}
						/>
					</div>
				{/if}
			{/if}
		</div>

		{#if channel.kind === 'voice'}
			<div>
				<span class="eyebrow">sounds</span>
				<div class="mt-1">
					<Select
						label="sound pack for {channel.name}"
						disabled={busy}
						value={channel.soundPack ?? 'base'}
						options={[
							{ value: 'base', label: 'Base — the synthwave set' },
							{ value: 'silent', label: 'Silent — visual cues only' },
						]}
						onchange={(soundPack) =>
							void patch({ soundPack: soundPack as 'base' | 'silent' })}
					/>
				</div>
			</div>
			<ChannelAutoplay {channel} {playlists} onsaved={() => void onchange()} />
		{/if}

		<button
			onclick={() => void remove()}
			disabled={busy}
			class="btn btn-danger btn-xs">{deleteLabel(channel.kind)}</button
		>
	</div>
</details>
