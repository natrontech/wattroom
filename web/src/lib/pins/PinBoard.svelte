<script module lang="ts">
	/**
	 * A pin is a label and a value (#2405). That is the whole data model, and
	 * the bound is the feature: no rich text, no attachments, no comments, no
	 * threads. A crew keeps a handful of facts that nothing else holds — the
	 * game server and its password, the Discord link, the door code — and chat
	 * cannot, because `PruneChat` caps a room at 500 lines.
	 *
	 * The crew owns pins; a room draws its crew's, read-only, with `from`.
	 * One editor surface, so nobody hunts for which of five rooms a pin is on.
	 */
	export interface Pin {
		id: string;
		label: string;
		value: string;
	}

	/**
	 * A value that is a link opens on click; everything else copies. One
	 * branch instead of a `kind` column the pinner would have to set — and
	 * getting it wrong costs a wrong icon, never a wrong action, because the
	 * menu carries both.
	 */
	export const isLink = (value: string) => /^https?:\/\//i.test(value.trim());
</script>

<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { copyText, theLinkItself } from '$lib/copy';
	import { toasts } from '$lib/toast.svelte';
	import Copy from '@lucide/svelte/icons/copy';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Pencil from '@lucide/svelte/icons/pencil';
	import PinIcon from '@lucide/svelte/icons/pin';
	import PinOff from '@lucide/svelte/icons/pin-off';

	let {
		pins,
		canEdit = false,
		from,
		onsave,
		onremove,
	}: {
		pins: Pin[];
		/** Crew admins pin; everyone reads. A room draws it false either way. */
		canEdit?: boolean;
		/** Set when these are someone else's pins seen from a room. */
		from?: { name: string; href: string };
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
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
		<h2 class="eyebrow">pins</h2>
		{#if from}
			<!-- Read-only in a room: name whose they are, and let the name be
			     the way to where they are changed, rather than drawing an edit
			     button this surface cannot honour (ux.md). -->
			<a href={from.href} class="btn-link text-xs">from {from.name}</a>
		{/if}
		<span class="flex-1"></span>
		<!-- Nothing pinned yet: the empty state's CTA is the button, and a
		     second one up here said the same word twice. -->
		{#if canEdit && pins.length > 0}
			<button
				onclick={() => (draft = { label: '', value: '' })}
				class="btn btn-secondary btn-xs shrink-0"
				><PinIcon size={13} /> Pin something</button
			>
		{/if}
	</div>

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
		<!-- Three across on a desk, one on a phone. The whole card is the
		     target — two lines at py-3 clears the 44 px riding bar (ux.md),
		     and there is no small icon to hit. -->
		<ul class="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
