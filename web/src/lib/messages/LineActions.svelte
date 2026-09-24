<script lang="ts">
	// A line's actions on its own row (#2642). The right-click menu is the
	// shortcut, never the only way (ux.md) — Delete used to live nowhere else.
	// A desk sees the strip on hover; touch has no hover and a rider three
	// metres away cannot hit a 13px icon anyway (#663), so there only the ⋯
	// shows, always, and opens the very menu a long-press does.
	import Copy from '@lucide/svelte/icons/copy';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Pencil from '@lucide/svelte/icons/pencil';
	import SmilePlus from '@lucide/svelte/icons/smile-plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { openMenu, type MenuEntry } from '$lib/context-menu.svelte';
	import { copyText } from '$lib/copy';

	let {
		text,
		onEdit,
		onReact,
		onDelete,
		menu,
	}: {
		/** The line's words, for Copy; empty for a picture alone. */
		text: string;
		/** Each is offered only when the thread allows it for this line. */
		onEdit?: () => void;
		onReact?: () => void;
		onDelete?: () => void;
		menu: () => MenuEntry[];
	} = $props();

	const button = 'icon-btn text-muted-dim hover:text-ink h-6 w-6';
</script>

<span
	class="flex shrink-0 gap-1 self-start opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100"
>
	{#if onEdit}
		<button
			onclick={onEdit}
			class="{button} pointer-coarse:hidden"
			aria-label="edit message"><Pencil size={13} /></button
		>
	{/if}
	{#if text}
		<button
			onclick={() => void copyText(text, 'Message copied.')}
			class="{button} pointer-coarse:hidden"
			aria-label="copy message"><Copy size={13} /></button
		>
	{/if}
	{#if onReact}
		<button
			onclick={onReact}
			class="{button} pointer-coarse:hidden"
			aria-label="react"><SmilePlus size={14} /></button
		>
	{/if}
	{#if onDelete}
		<button
			onclick={onDelete}
			class="icon-btn text-muted-dim hover:text-danger h-6 w-6 pointer-coarse:hidden"
			aria-label="delete message"><Trash2 size={13} /></button
		>
	{/if}
	<button
		onclick={(e) => {
			const at = e.currentTarget.getBoundingClientRect();
			openMenu(menu(), at.left, at.bottom + 4, e.currentTarget);
		}}
		class={button}
		aria-label="more actions"
		aria-haspopup="menu"><Ellipsis size={14} /></button
	>
</span>
