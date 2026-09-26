<script lang="ts">
	import Copy from '@lucide/svelte/icons/copy';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import Repeat from '@lucide/svelte/icons/repeat';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { ZONE_BG, zoneOfStep } from '$lib/components/zones';
	import { formatClock } from '$lib/format';
	import {
		addInto,
		append,
		duplicate,
		move,
		removeAndSelect,
		reorder,
		sameParent,
		STEP_TYPES,
		wrapInRepeat,
	} from '$lib/workout/tree';
	import type { Workout, WorkoutStep } from '$lib/workout/types';

	let {
		workout,
		selected = $bindable(),
		ftp,
	}: {
		workout: Workout;
		selected: number[] | null;
		ftp: number;
	} = $props();

	const isSelected = (path: number[]) => selected?.join('.') === path.join('.');

	function stepSeconds(step: WorkoutStep): number {
		if (step.type === 'repeat') {
			return (
				step.times *
				step.steps.reduce((sum, inner) => sum + stepSeconds(inner), 0)
			);
		}
		return step.seconds;
	}

	function describe(step: WorkoutStep): string {
		if (step.type === 'repeat') return `${step.times} ×`;
		if (step.type === 'sprint') return 'all out';
		if (step.type === 'steady') {
			return step.watts !== undefined
				? `${step.watts} W`
				: `${Math.round((step.target ?? 0) * 100)}% FTP`;
		}
		return `${Math.round(step.from * 100)} → ${Math.round(step.to * 100)}% FTP`;
	}

	// Drag to reorder (#170's intuitiveness bar): native HTML5 drag, no
	// dependency. The arrow buttons stay — drag is mouse-only and the keyboard
	// path is part of the editor, not a fallback. A drop is only offered
	// between siblings; tree.reorder's comment says why.
	let dragPath = $state<number[] | null>(null);
	let dropPath = $state<number[] | null>(null);
	let dropAfter = $state(false);

	const dropIndex = $derived(
		dropPath === null
			? null
			: dropPath[dropPath.length - 1] + (dropAfter ? 1 : 0),
	);

	function drop() {
		if (dragPath && dropPath && dropIndex !== null) {
			selected = reorder(workout, dragPath, dropIndex) ?? selected;
		}
		dragPath = dropPath = null;
	}

	function stepMenu(path: number[], step: WorkoutStep): MenuEntry[] {
		return [
			{
				label: 'Duplicate',
				icon: Copy,
				onSelect: () => (selected = duplicate(workout, path) ?? selected),
			},
			{
				label: 'Move up',
				icon: ChevronUp,
				onSelect: () => (selected = move(workout, path, -1) ?? selected),
			},
			{
				label: 'Move down',
				icon: ChevronDown,
				onSelect: () => (selected = move(workout, path, 1) ?? selected),
			},
			'separator',
			{
				label: 'Wrap in a repeat',
				icon: Repeat,
				// A repeat wrapping a repeat is legal but reads as an accident.
				disabled: step.type === 'repeat',
				onSelect: () => (selected = wrapInRepeat(workout, path) ?? selected),
			},
			'separator',
			{
				label: 'Delete',
				icon: Trash2,
				danger: true,
				onSelect: () => {
					selected = removeAndSelect(workout, path);
				},
			},
		];
	}
</script>

<h2 class="eyebrow">steps</h2>
<ul class="mt-3 space-y-1.5">
	{#snippet stepRow(step: WorkoutStep, path: number[])}
		{@const dragging = dragPath?.join('.') === path.join('.')}
		{@const lineAbove = dropPath?.join('.') === path.join('.') && !dropAfter}
		{@const lineBelow = dropPath?.join('.') === path.join('.') && dropAfter}
		<li
			draggable="true"
			ondragstart={(e) => {
				dragPath = path;
				e.dataTransfer?.setData('text/plain', path.join('.'));
				if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
				e.stopPropagation();
			}}
			ondragover={(e) => {
				if (!dragPath || !sameParent(dragPath, path)) return;
				e.preventDefault();
				e.stopPropagation();
				const rect = e.currentTarget.getBoundingClientRect();
				dropPath = path;
				dropAfter = e.clientY > rect.top + rect.height / 2;
			}}
			ondrop={(e) => {
				e.preventDefault();
				e.stopPropagation();
				drop();
			}}
			ondragend={() => (dragPath = dropPath = null)}
			class="{dragging ? 'opacity-40' : ''} {lineAbove
				? 'border-t-neon/70 border-t-2'
				: lineBelow
					? 'border-b-neon/70 border-b-2'
					: ''} cursor-grab rounded-lg active:cursor-grabbing"
			{@attach contextMenu(() => stepMenu(path, step))}
		>
			<button
				onclick={() => (selected = path)}
				title={MENU_HINT}
				class="flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left {isSelected(
					path,
				)
					? 'bg-surface-raised border-ink/40'
					: 'border-muted/15 hover:border-muted/40'}"
			>
				<GripVertical size={14} class="text-muted-dim -ml-1 shrink-0" />
				<span
					class="h-8 w-1.5 shrink-0 rounded-full {step.type === 'sprint'
						? 'bg-z7'
						: step.type === 'repeat'
							? 'bg-muted/40'
							: ZONE_BG[zoneOfStep(step, ftp)]}"
				></span>
				<span class="min-w-0 flex-1">
					<span class="block text-sm font-medium capitalize">{step.type}</span>
					<span class="text-muted block text-xs">{describe(step)}</span>
				</span>
				<span class="text-muted shrink-0 font-mono text-xs tabular-nums"
					>{formatClock(stepSeconds(step))}</span
				>
			</button>
			{#if step.type === 'repeat'}
				<!-- The repeat's own steps, indented and just as editable (#255) —
				     and since #1004, addable and draggable in the same ways. -->
				<ul class="mt-1.5 mb-1 ml-7 space-y-1.5">
					{#each step.steps as inner, j (j)}
						{@render stepRow(inner, [...path, j])}
					{/each}
					<li class="flex flex-wrap gap-2">
						{#each STEP_TYPES as type (type)}
							<button
								onclick={() =>
									(selected = addInto(workout, path, type) ?? selected)}
								class="btn btn-secondary btn-xs capitalize">+ {type}</button
							>
						{/each}
					</li>
				</ul>
			{/if}
		</li>
	{/snippet}
	{#each workout.steps as step, i (i)}
		{@render stepRow(step, [i])}
	{/each}
</ul>

<div class="mt-3 flex flex-wrap gap-2">
	{#each STEP_TYPES as type (type)}
		<button
			onclick={() => (selected = append(workout, type))}
			class="btn btn-secondary btn-xs capitalize">+ {type}</button
		>
	{/each}
</div>
