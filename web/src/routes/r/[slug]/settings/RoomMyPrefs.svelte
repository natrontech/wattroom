<script lang="ts">
	// The rider's own settings for a room (#1100), theirs alone: notify and
	// the weekly board. Saves through the rider's own endpoint, so an owner
	// editing the room never touches them. Split from the page (#1265).
	import { api } from '$lib/api';
	import { toasts } from '$lib/toast.svelte';

	interface RiderPrefs {
		notify: boolean;
		onBoard: boolean;
	}
	let {
		slug,
		me,
		boardEnabled = false,
	}: { slug: string; me?: RiderPrefs; boardEnabled?: boolean } = $props();

	let notify = $state(true);
	let onBoard = $state(true);
	let saving = $state(false);
	$effect(() => {
		// What the server holds is the truth, on mount and on every re-read of
		// the room (a lobby ping).
		notify = me?.notify ?? true;
		onBoard = me?.onBoard ?? true;
	});

	// Whole object on every change, like the room's own settings: there is no
	// partial shape to get wrong, and the response is the truth we keep.
	async function savePrefs(next: Partial<RiderPrefs>) {
		saving = true;
		const res = await api<RiderPrefs>(`/api/rooms/${slug}/me`, {
			method: 'PATCH',
			body: JSON.stringify({ notify, onBoard, ...next }),
		});
		saving = false;
		if (res.ok) {
			notify = res.data.notify;
			onBoard = res.data.onBoard;
		} else {
			// Put the switches back to what the server still holds, so the UI
			// never shows a preference that did not save.
			notify = me?.notify ?? true;
			onBoard = me?.onBoard ?? true;
			toasts.push(res.error.message, { tone: 'error' });
		}
	}
</script>

<!-- The rider's own settings (#1100). Between "the owner decides for
		     everybody" and "a global app setting" there was nothing, and the
		     weekly board is the case that shows why: a room-level switch
		     answers "joining must not put you on a board", and leaves the
		     same trap standing for everyone already inside when the owner
		     turns it on (ADR-0036, amended). -->
<section class="border-muted/15 mt-4 rounded-lg border p-6">
	<h2 class="font-display font-bold">Your settings for this room</h2>
	<p class="text-muted mt-1.5 text-xs">
		Yours alone — nobody else sees them, and the owner cannot change them.
	</p>
	<label
		class="border-muted/15 mt-3 flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3"
	>
		<input
			type="checkbox"
			bind:checked={notify}
			onchange={() => savePrefs({ notify })}
			disabled={saving}
		/>
		<span class="min-w-0">
			<span class="block text-sm font-medium">Notify me about this room</span>
			<span class="text-muted block text-xs">
				Planned sessions here reach you by email. Turning off every room's mail
				at once is on <a href="/settings/notifications" class="btn-link"
					>Notifications</a
				>.
			</span>
		</span>
	</label>
	<label
		class="border-muted/15 mt-2 flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3"
	>
		<input
			type="checkbox"
			bind:checked={onBoard}
			onchange={() => savePrefs({ onBoard })}
			disabled={saving}
		/>
		<span class="min-w-0">
			<span class="block text-sm font-medium">
				Include me on the weekly board
			</span>
			<span class="text-muted block text-xs">
				{boardEnabled
					? "Off keeps your kJ off the room's board. It changes nothing else."
					: "This room's board is off, so nothing is ranked here yet — this is what happens if the owner turns it on."}
			</span>
		</span>
	</label>
</section>
