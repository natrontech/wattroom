<script lang="ts">
	// Launch at login (#1313), beside Notifications because it is the other
	// thing WattRoom does to a rider's machine rather than inside its own
	// window. Nothing renders in a browser — there is no login item to set —
	// and nothing renders in a shell that cannot set one, rather than a
	// switch that fails on click (ux.md).
	//
	// Off by default and never turned on by an install: the 95 % rule says a
	// setting is a setting when riders would not agree on it, and nobody
	// expects a cycling app in their login items. It is undone from here, or
	// from the tray's own switch — never by editing OS config.
	import {
		launchAtLogin,
		setLaunchAtLogin,
		shellPlatform,
		trayName,
		type LoginItem,
	} from '$lib/desktop';

	let item = $state<LoginItem | null>(null);
	let saving = $state(false);
	const tray = trayName(shellPlatform());

	$effect(() => {
		void launchAtLogin().then((state) => (item = state));
	});

	// The box goes back when the change does not land, the way the mail
	// switch next door does (#2181): `checked` is read from the shell's
	// answer, so a refused change would otherwise leave a tick the rider's
	// click put there with nothing behind it.
	async function toggle(box: HTMLInputElement) {
		const on = box.checked;
		saving = true;
		const next = await setLaunchAtLogin(on);
		saving = false;
		if (!next) {
			box.checked = !on;
			return;
		}
		item = next;
		box.checked = next.enabled;
	}
</script>

{#if item?.supported}
	<section class="panel panel-xl mt-8">
		<h2 class="font-display font-bold">This computer</h2>
		<label class="text-muted mt-3 flex items-start gap-2 text-sm">
			<input
				type="checkbox"
				checked={item.enabled}
				disabled={saving}
				onchange={(e) => void toggle(e.currentTarget)}
				class="mt-1"
			/>
			<span>
				Start WattRoom when I sign in to this computer
				<span class="text-muted block text-xs">
					It comes up in {tray} with no window — click it when you are ready to ride.
					Quit it from there too.
				</span>
			</span>
		</label>
		{#if item.error}
			<p class="text-danger mt-2 text-xs">{item.error}</p>
		{/if}
	</section>
{/if}
