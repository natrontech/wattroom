<script lang="ts">
	// The one menu (#465). Fixed, above dialogs and the dock; keyboard walks
	// it; Escape, a click anywhere else, a scroll or a resize close it.
	import { closeMenu, menu, placeMenu } from '$lib/context-menu.svelte';

	let box = $state<HTMLDivElement | null>(null);
	let pos = $state({ left: 0, top: 0 });
	const open = $derived(menu.items.length > 0);

	$effect(() => {
		if (!open || !box) return;
		const node = box;
		const { x, y } = menu;
		pos = placeMenu(
			x,
			y,
			node.offsetWidth,
			node.offsetHeight,
			innerWidth,
			innerHeight,
		);
		node
			.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
			?.focus();
		const away = (event: Event) => {
			if (!node.contains(event.target as Node)) closeMenu();
		};
		const dismiss = () => closeMenu();
		document.addEventListener('pointerdown', away, true);
		window.addEventListener('scroll', dismiss, true);
		window.addEventListener('resize', dismiss);
		return () => {
			document.removeEventListener('pointerdown', away, true);
			window.removeEventListener('scroll', dismiss, true);
			window.removeEventListener('resize', dismiss);
		};
	});

	function onKey(event: KeyboardEvent) {
		if (!box) return;
		const items = [
			...box.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
		];
		const at = items.indexOf(document.activeElement as HTMLElement);
		if (event.key === 'Escape') {
			event.preventDefault();
			closeMenu();
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			items[(at + 1) % items.length]?.focus();
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			items[(at - 1 + items.length) % items.length]?.focus();
		} else if (event.key === 'Tab') {
			closeMenu();
		}
	}
</script>

{#if open}
	<div
		bind:this={box}
		role="menu"
		tabindex="-1"
		onkeydown={onKey}
		class="panel fixed z-[70] min-w-44 py-1 shadow-2xl"
		style="left: {pos.left}px; top: {pos.top}px"
	>
		{#each menu.items as item, i (i)}
			{#if item === 'separator'}
				<div class="border-ink/10 my-1 border-t" role="separator"></div>
			{:else}
				<button
					role="menuitem"
					disabled={item.disabled}
					onclick={() => {
						const run = item.onSelect;
						closeMenu();
						run();
					}}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm disabled:opacity-40 {item.danger
						? 'text-danger hover:bg-danger/10'
						: 'hover:bg-surface'}"
				>
					{#if item.icon}<item.icon
							size={14}
							class="shrink-0 opacity-80"
						/>{/if}
					<span class="min-w-0 flex-1 truncate">{item.label}</span>
					{#if item.hint}<span class="text-muted shrink-0 text-[11px]"
							>{item.hint}</span
						>{/if}
				</button>
			{/if}
		{/each}
	</div>
{/if}
