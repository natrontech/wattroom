<script lang="ts">
	// Notifications, offered once where they would matter (#1485, ADR-0042).
	//
	// Until now the only way to switch them on was the button in Settings, so
	// the rider who most needs them — joined a crew, closed the tab — was
	// never told the app could tap them on the shoulder. ADR-0042 assumes
	// they are on; this is what makes that assumption reachable.
	//
	// The offer rides along with the first session a rider sees planned in one
	// of their rooms: the caller renders it there, this decides whether it can
	// do anything at all (notify.offered — never over an already-on switch,
	// never in a browser that has blocked them, never twice). No permission
	// dialog until the rider presses the button; the 95% rule cuts against a
	// prompt nobody asked for.
	//
	// Home's "What's next", not the room's Sessions place: the same rule that
	// keeps DesktopNotice on home (ux.md — never mid-ride), and home is the
	// one list that spans every room the rider is in.
	import { toasts } from '$lib/toast.svelte';
	import { notify } from '$lib/notify.svelte';
	import BellRing from '@lucide/svelte/icons/bell-ring';

	// Either answer retires the offer, and waveOffer is what takes the line
	// away — a prompt waved away without an answer is answered too. The switch
	// in Settings is where a permission is picked up again, and the toast says
	// so rather than the line asking a second time.
	async function turnOn() {
		const verdict = await notify.enable();
		notify.waveOffer();
		if (verdict === 'granted' || verdict === 'shell')
			toasts.push(
				'Notifications on. A session starting, a message or someone walking in reaches you while WattRoom is behind another window.',
				{ href: '/settings/notifications' },
			);
		else if (verdict === 'denied')
			toasts.push(
				"This browser blocked notifications and will not ask again. Allow them for this site in the browser's site settings, then turn them on in Settings.",
				{ tone: 'error', href: '/settings/notifications', seconds: 10 },
			);
		else
			toasts.push('No answer given — you can turn them on in Settings.', {
				href: '/settings/notifications',
			});
	}
	const no = () => notify.waveOffer();
</script>

{#if notify.offered}
	<div
		class="border-neon/30 bg-surface-raised mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3"
		role="status"
	>
		<BellRing size={16} class="text-muted shrink-0" />
		<p class="text-muted min-w-56 flex-1 text-sm leading-relaxed">
			Get told when the room starts riding — a session starting, a message or
			someone walking in reaches you while WattRoom is behind another window.
		</p>
		<button class="btn btn-primary" onclick={() => void turnOn()}
			>Turn on notifications</button
		>
		<button class="btn-link text-xs" onclick={no}>No thanks</button>
	</div>
{/if}
