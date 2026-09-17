<script lang="ts">
	// The rider's own settings for a room (#1100), theirs alone: notify and
	// the weekly board. Saves through the rider's own endpoint, so an owner
	// editing the room never touches them. Split from the page (#1265).
	import { api } from '$lib/api';
	import { toasts } from '$lib/toast.svelte';
	import type { RiderPrefs } from '$lib/room/room-data';

	let {
		slug,
		me,
		boardEnabled = false,
	}: { slug: string; me?: RiderPrefs; boardEnabled?: boolean } = $props();

	let notify = $state(true);
	let onBoard = $state(true);
	let saving = $state(false);
	// What the server last confirmed — the parent's snapshot to start with,
	// then every save that came back OK (#2163). The rollback below used to
	// read `me`, which only a re-read of the whole room refreshes: turn Notify
	// off (it saves), then let the board switch fail, and BOTH went back to a
	// snapshot taken before the first change. The promise under the rollback
	// is that the switches never show a preference that did not save; reading
	// a stale snapshot broke it the other way round, by showing a saved one as
	// unsaved.
	// A plain `let`, deliberately: nothing renders it, and making it `$state`
	// put the effect below in a loop with itself
	// (`effect_update_depth_exceeded`) — which silently ate the save's whole
	// failure path, toast and all.
	let held: RiderPrefs = { notify: true, onBoard: true };
	$effect(() => {
		// What the server holds is the truth, on mount and on every re-read of
		// the room (a lobby ping).
		held = { notify: me?.notify ?? true, onBoard: me?.onBoard ?? true };
		notify = held.notify;
		onBoard = held.onBoard;
	});

	// Whole object on every change, like the room's own settings: there is no
	// partial shape to get wrong, and the response is the truth we keep.
	async function savePrefs(next: Partial<RiderPrefs>) {
		saving = true;
		// `json`, never a raw `body` (#2163): api() sets the content type only
		// for `json`, and fetch defaults a string body to text/plain — which
		// httpx.DecodeStrict refuses outright, because a form-encodable type
		// is what a cross-site form can post without a preflight. So this
		// endpoint answered 400 to every press and NEITHER switch has ever
		// saved from this screen.
		const res = await api<RiderPrefs>(`/api/rooms/${slug}/me`, {
			method: 'PATCH',
			json: { notify, onBoard, ...next },
		});
		saving = false;
		if (res.ok) {
			held = { notify: res.data.notify, onBoard: res.data.onBoard };
			notify = held.notify;
			onBoard = held.onBoard;
		} else {
			// Back to what the server still holds — which includes whatever
			// saved a moment ago, not only what the page was loaded with.
			notify = held.notify;
			onBoard = held.onBoard;
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
