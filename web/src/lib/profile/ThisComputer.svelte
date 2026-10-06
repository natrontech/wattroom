<script lang="ts">
	// What WattRoom does to a rider's machine rather than inside its own
	// window, beside Notifications: launch at login (#1313) and the tray icon
	// (#3843). Nothing renders in a browser, and a switch renders only where
	// the shell can act on it, rather than one that fails on click (ux.md).
	//
	// Launch at login is off by default and never turned on by an install:
	// nobody expects a cycling app in their login items. The tray icon is off
	// by default on macOS, where the Dock already brings the window back, and
	// on elsewhere, where it is the only way back to a hidden window. Both are
	// undone from here — never by editing OS config.
	import {
		launchAtLogin,
		setLaunchAtLogin,
		setTrayIcon,
		shellPlatform,
		trayIcon,
		trayName,
		type ShellSwitch,
	} from '$lib/desktop';

	let login = $state<ShellSwitch | null>(null);
	let icon = $state<ShellSwitch | null>(null);
	let saving = $state(false);
	const mac = shellPlatform() === 'darwin';
	const tray = trayName(shellPlatform());
	// Where a hidden WattRoom is found again: the Dock on macOS, the icon elsewhere.
	const home = mac ? 'the Dock' : tray;
	// Windows and Linux without the icon show the window at login: hidden,
	// there would be no way back to it.
	const startsHidden = $derived(mac || icon?.enabled === true);

	$effect(() => {
		void launchAtLogin().then((state) => (login = state));
		void trayIcon().then((state) => (icon = state));
	});

	// The box goes back when the change does not land, the way the mail
	// switch next door does (#2181): `checked` is read from the shell's
	// answer, so a refused change would otherwise leave a tick the rider's
	// click put there with nothing behind it.
	async function toggle(
		box: HTMLInputElement,
		set: (on: boolean) => Promise<ShellSwitch | null>,
		keep: (next: ShellSwitch) => void,
	) {
		const on = box.checked;
		saving = true;
		const next = await set(on);
		saving = false;
		if (!next) {
			box.checked = !on;
			return;
		}
		keep(next);
		box.checked = next.enabled;
	}
</script>

{#if login?.supported || icon?.supported}
	<section class="panel panel-xl mt-8">
		<h2 class="font-display font-bold">This computer</h2>
		{#if login?.supported}
			<label class="text-muted mt-3 flex items-start gap-2 text-sm">
				<input
					type="checkbox"
					checked={login.enabled}
					disabled={saving}
					onchange={(e) =>
						void toggle(e.currentTarget, setLaunchAtLogin, (n) => (login = n))}
					class="mt-1"
				/>
				<span>
					Start WattRoom when I sign in to this computer
					<span class="text-muted block text-xs">
						{#if startsHidden}
							It starts in {home} with its window hidden, so messages and session
							reminders reach you from the moment you sign in. While it runs your
							crews see you online — quit it from {home} to go offline.
						{:else}
							It opens when you sign in, so messages and session reminders reach
							you from the moment you do. While it runs your crews see you
							online — quit it to go offline.
						{/if}
					</span>
				</span>
			</label>
			{#if login.error}
				<p class="text-danger mt-2 text-xs">{login.error}</p>
			{/if}
		{/if}
		{#if icon?.supported}
			<label class="text-muted mt-3 flex items-start gap-2 text-sm">
				<input
					type="checkbox"
					checked={icon.enabled}
					disabled={saving}
					onchange={(e) =>
						void toggle(e.currentTarget, setTrayIcon, (n) => (icon = n))}
					class="mt-1"
				/>
				<span>
					Show WattRoom in {tray}
					<span class="text-muted block text-xs">
						{#if mac}
							Open WattRoom or the voice channel you are in from there. The Dock
							does the same.
						{:else}
							Closing the window keeps WattRoom running there, so messages and
							session reminders still reach you. Without it, closing the window
							quits WattRoom.
						{/if}
					</span>
				</span>
			</label>
			{#if icon.error}
				<p class="text-danger mt-2 text-xs">{icon.error}</p>
			{/if}
		{/if}
	</section>
{/if}
