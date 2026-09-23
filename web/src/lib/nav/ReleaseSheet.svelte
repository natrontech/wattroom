<script lang="ts">
	// What a release brought (#2588), opened from the update row — the sheet
	// that replaced Home's what's-new panel, which nobody saw once WattRoom
	// started in your crew. Opened by the rider, never by itself: ux.md, a
	// changelog is never worth interrupting an interval for.
	//
	// The first new thing is the headline, said large, with the rest of its
	// entry under it; every other entry wears its section's mark. The releases
	// that landed while you were away open in place.
	import Modal from '$lib/components/Modal.svelte';
	import MessageText from '$lib/chat/MessageText.svelte';
	import { changelog } from '$lib/changelog.svelte';
	import { headline, type Release } from '$lib/changelog';
	import type { ReleaseAction } from '$lib/release-actions';
	import type { Icon } from '$lib/icons';
	import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Clock from '@lucide/svelte/icons/clock';
	import Minus from '@lucide/svelte/icons/minus';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Wrench from '@lucide/svelte/icons/wrench';
	import X from '@lucide/svelte/icons/x';

	let { onclose }: { onclose: () => void } = $props();

	/** Keep a Changelog's six headings, each with its mark. */
	const MARKS: Record<string, Icon> = {
		Added: Sparkles,
		Changed: ArrowLeftRight,
		Fixed: Wrench,
		Removed: Minus,
		Deprecated: Clock,
		Security: ShieldCheck,
	};

	const release = $derived(
		changelog.unseen ??
			changelog.releases?.find((r) => r.version === changelog.version) ??
			null,
	);
	const entries = (r: Release) =>
		r.sections.flatMap((s) =>
			s.items.map((text) => ({ heading: s.heading, text })),
		);
	const items = $derived(release ? entries(release) : []);
	const lead = $derived(items[0]);
	const leadRest = $derived(
		lead ? lead.text.slice(headline(lead.text).length).trim() : '',
	);
	const day = (iso: string | null) =>
		iso
			? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
					weekday: 'long',
					day: 'numeric',
					month: 'long',
				})
			: '';

	// A tapped action stays put, disabled, saying what it did. Letting it
	// vanish under the finger reads as a misfire.
	let done = $state(new Set<string>());
	function apply(action: ReleaseAction) {
		action.run();
		done = new Set(done).add(action.id);
	}

	function gotIt() {
		changelog.dismiss();
		onclose();
	}
</script>

{#snippet mark(heading: string, lit = false)}
	{@const Glyph = MARKS[heading] ?? Sparkles}
	<span
		class="grid size-7 shrink-0 place-items-center rounded-lg {lit
			? 'bg-neon text-paper'
			: 'border-ink/20 border'}"><Glyph size={15} /></span
	>
{/snippet}

<Modal label="What's new" {onclose} placement="right" class="max-w-lg">
	{#if release}
		<div class="flex min-h-full flex-col">
			<div class="flex items-center justify-between px-8 pt-7">
				<p class="eyebrow text-neon">what's new</p>
				<button
					type="button"
					onclick={onclose}
					class="border-ink/15 hover:bg-ink/5 grid size-9 place-items-center rounded-lg border"
					aria-label="close"><X size={16} /></button
				>
			</div>
			<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-8 pt-2">
				<h2 class="font-display text-4xl font-bold tracking-tight">
					{release.version}
				</h2>
				<span class="text-muted text-sm">{day(release.date)}</span>
				{#if release.version === changelog.version}
					<span
						class="border-neon/45 text-neon rounded-full border px-2 py-0.5 text-[11px] font-semibold"
						>running now</span
					>
				{/if}
			</div>

			<div class="flex-1 space-y-6 px-8 pt-7 pb-6">
				{#if lead}
					<section class="space-y-3">
						<div class="flex items-center gap-2.5">
							{@render mark(lead.heading, true)}
							<span class="eyebrow">{lead.heading}</span>
						</div>
						<p class="text-xl leading-snug font-semibold">
							<MessageText text={headline(lead.text)} preview={false} />
						</p>
						{#if leadRest}
							<p class="text-muted leading-relaxed">
								<MessageText text={leadRest} preview={false} />
							</p>
						{/if}
					</section>
				{/if}

				{#if changelog.actions.length}
					<div class="space-y-3">
						{#each changelog.actions as action (action.id)}
							<div class="flex flex-wrap items-center gap-3">
								<p class="text-muted min-w-40 flex-1 text-sm">{action.note}</p>
								<button
									class="btn btn-primary"
									disabled={done.has(action.id)}
									onclick={() => apply(action)}
								>
									{done.has(action.id) ? action.done() : action.label()}
								</button>
							</div>
						{/each}
					</div>
				{/if}

				<!-- Unkeyed on purpose, like /whats-new: render-only lists whose
				     text can repeat within a release. -->
				{#each items.slice(1) as item}
					<div class="border-ink/10 flex gap-3.5 border-t pt-5">
						{@render mark(item.heading)}
						<div class="min-w-0 space-y-1">
							<p class="eyebrow">{item.heading}</p>
							<p class="leading-relaxed">
								<MessageText text={item.text} preview={false} />
							</p>
						</div>
					</div>
				{/each}

				{#if changelog.skipped.length}
					<div class="border-ink/10 space-y-2 border-t pt-5">
						<p class="eyebrow">while you were away</p>
						{#each changelog.skipped as earlier (earlier.version)}
							{@const first = entries(earlier)[0]}
							<details class="bg-surface-raised group rounded-lg">
								<summary
									class="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden"
								>
									<span class="font-display w-24 shrink-0 font-bold"
										>{earlier.version}</span
									>
									<span class="min-w-0 flex-1 truncate"
										>{first ? headline(first.text) : ''}</span
									>
									<ChevronDown
										size={14}
										class="text-muted shrink-0 transition-transform group-open:rotate-180"
									/>
								</summary>
								<ul class="space-y-2 px-3 pb-3">
									{#each entries(earlier) as item}
										<li class="flex gap-2.5 text-sm leading-relaxed">
											<span class="eyebrow mt-0.5 w-16 shrink-0"
												>{item.heading}</span
											>
											<span
												><MessageText text={item.text} preview={false} /></span
											>
										</li>
									{/each}
								</ul>
							</details>
						{/each}
					</div>
				{/if}
			</div>

			<div
				class="border-ink/10 bg-surface sticky bottom-0 flex items-center justify-between border-t px-8 py-4"
			>
				<a href="/whats-new" onclick={onclose} class="btn-link text-sm"
					>All releases</a
				>
				<button type="button" onclick={gotIt} class="btn btn-primary btn-lg"
					>Got it</button
				>
			</div>
		</div>
	{/if}
</Modal>
