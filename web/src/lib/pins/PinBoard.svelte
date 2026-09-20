<script lang="ts">
	// The board itself (#2405): the grid, the menu and the editor. What a pin
	// IS lives in `pins.svelte.ts`, which the sidebar's gate reads too.
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { copyText, theLinkItself } from '$lib/copy';
	import { isLink, type Pin } from './pins.svelte';
	import { toasts } from '$lib/toast.svelte';
	import Copy from '@lucide/svelte/icons/copy';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Pencil from '@lucide/svelte/icons/pencil';
	import PinIcon from '@lucide/svelte/icons/pin';
	import PinOff from '@lucide/svelte/icons/pin-off';

	let {
		pins,
		canEdit = false,
		crewName = '',
		onsave,
		onremove,
	}: {
		pins: Pin[];
		/** Crew admins pin; everyone else reads and copies. */
		canEdit?: boolean;
		/** Named in the subline, so the scope of an edit is on the page. */
		crewName?: string;
		/** A new pin has no id yet. */
		onsave?: (pin: Pin | Omit<Pin, 'id'>) => void;
		onremove?: (pin: Pin) => void;
	} = $props();

	/** The pin being written, or null when the editor is shut. */
	let draft = $state<{ id?: string; label: string; value: string } | null>(
		null,
	);
	const ready = $derived(!!draft?.label.trim() && !!draft?.value.trim());

	function copy(pin: Pin) {
		void copyText(
			pin.value,
			`Copied ${pin.label}.`,
			isLink(pin.value) ? theLinkItself(pin.value) : undefined,
		);
	}

	function unpin(pin: Pin) {
		// Undo over confirm (errors.md): a pin is two fields and putting it
		// back is exact, so nothing is lost by doing it and offering the way
		// back — no dialog in front of every tidy-up.
		onremove?.(pin);
		toasts.push(`Unpinned ${pin.label}.`, { undo: () => onsave?.(pin) });
	}

	function entries(pin: Pin): MenuEntry[] {
		const list: MenuEntry[] = [
			{
				label: isLink(pin.value) ? 'Copy the link' : 'Copy',
				icon: Copy,
				onSelect: () => copy(pin),
			},
		];
		if (!canEdit) return list;
		list.push(
			{ label: 'Edit', icon: Pencil, onSelect: () => (draft = { ...pin }) },
			'separator',
			{
				label: 'Unpin',
				icon: PinOff,
				danger: true,
				onSelect: () => unpin(pin),
			},
		);
		return list;
	}

	function save() {
		if (!draft || !ready) return;
		const { id, label, value } = draft;
		onsave?.({
			...(id ? { id } : {}),
			label: label.trim(),
			value: value.trim(),
		} as Pin);
		draft = null;
	}
</script>

{#snippet face(pin: Pin)}
	<span class="min-w-0 flex-1">
		<span class="eyebrow block truncate">{pin.label}</span>
		<!-- A server address is one long unbreakable token, which is exactly
		     what overflowed a phone in #2400. It wraps here rather than
		     widening the page. -->
		<span class="mt-0.5 block font-mono text-sm break-all">{pin.value}</span>
	</span>
{/snippet}

<section>
	<!-- The place's own head, drawn the way Sessions draws its (#2405): the
	     room's name is the sidebar's job (ADR-0020), so this says which place
	     you are standing in. One button to pin with — the empty state's while
	     the board is empty, this one once it is not. -->
	<div class="mb-1 flex items-center gap-3">
		<h2 class="font-display text-xl font-bold">Pins</h2>
		{#if canEdit && pins.length > 0}
			<button
				onclick={() => (draft = { label: '', value: '' })}
				class="btn btn-primary btn-xs ml-auto"
				><PinIcon size={13} /> Pin something</button
			>
		{/if}
	</div>
	<!-- Says the scope, because editing here changes them everywhere: the
	     crew owns pins, and its other rooms show the same board. -->
	<p class="text-muted mb-5 text-xs">
		What the crew keeps needing. The same board in every room of {crewName ||
			'the crew'}.
	</p>

	{#if pins.length === 0}
		{#if canEdit}
			<!-- Teaches, never apologizes (ux.md): what the thing is, and the
			     one button that makes the first one. A member with no pins to
			     read gets no section at all — there is nothing to teach them
			     about a thing only an admin can make. -->
			<div class="mt-2">
				<EmptyState>
					{#snippet icon()}<PinIcon size={20} />{/snippet}
					What the crew keeps needing: a server address, the Discord link, the door
					code.
					{#snippet cta()}
						<button
							onclick={() => (draft = { label: '', value: '' })}
							class="btn btn-secondary btn-lg">Pin something</button
						>
					{/snippet}
				</EmptyState>
			</div>
		{/if}
	{:else}
		<!-- Fills to the column it is in, not to the viewport. `sm:grid-cols-2
		     lg:grid-cols-3` looked right on a page and was wrong in a room,
		     where the content column is a good deal narrower than the window:
		     a Tailwind breakpoint asks the viewport, so three cards were
		     promised space the room never had and a Discord link broke mid
		     token. auto-fill asks the container, which is the thing that
		     actually decides.

		     The whole card is the target — two lines at py-3 clears the 44 px
		     riding bar (ux.md), and there is no small icon to hit. -->
		<ul class="mt-2 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">
			{#each pins as pin (pin.id)}
				<li
					class="panel panel-flush"
					title={MENU_HINT}
					{@attach contextMenu(() => entries(pin))}
				>
					{#if isLink(pin.value)}
						<a
							href={pin.value}
							target="_blank"
							rel="noreferrer noopener"
							class="hover:bg-ink/5 flex w-full items-start gap-2 rounded-lg px-4 py-3 text-left"
						>
							{@render face(pin)}
							<ExternalLink size={14} class="text-muted mt-3 shrink-0" />
						</a>
					{:else}
						<button
							onclick={() => copy(pin)}
							class="hover:bg-ink/5 flex w-full items-start gap-2 rounded-lg px-4 py-3 text-left"
						>
							{@render face(pin)}
							<Copy size={14} class="text-muted mt-3 shrink-0" />
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

{#if draft}
	<Modal
		label={draft.id ? 'Edit pin' : 'Pin something'}
		onclose={() => (draft = null)}
	>
		<h2 class="font-display text-lg leading-tight font-bold">
			{draft.id ? 'Edit pin' : 'Pin something'}
		</h2>
		<!-- The inputs come first in the DOM, so the trap's initial focus lands
		     in the label and typing works on open (ux.md's keyboard rule). -->
		<label class="mt-4 block">
			<span class="eyebrow">label</span>
			<input
				bind:value={draft.label}
				maxlength="40"
				placeholder="Minecraft"
				class="input mt-1 w-full"
			/>
		</label>
		<label class="mt-3 block">
			<span class="eyebrow">value</span>
			<input
				bind:value={draft.value}
				maxlength="200"
				placeholder="mc.example.org"
				class="input mt-1 w-full"
			/>
		</label>
		<!-- No mask and no reveal-on-click: every member reads a pin anyway, so
		     hiding it is theatre that costs a tap. Say it plainly instead. -->
		<p class="text-muted mt-3 text-xs">
			Everyone in the crew can read a pin. A link opens when tapped; anything
			else copies.
		</p>
		<div class="mt-5 flex flex-row-reverse flex-wrap justify-end gap-2">
			<button onclick={() => (draft = null)} class="btn btn-secondary btn-lg"
				>Cancel</button
			>
			<button onclick={save} disabled={!ready} class="btn btn-primary btn-lg"
				>{draft.id ? 'Save' : 'Pin it'}</button
			>
		</div>
	</Modal>
{/if}
