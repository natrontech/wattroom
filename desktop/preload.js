// The whole bridge between the shell and the web app (#296, ADR-0037).
//
// ADR-0037 fixes the contract: the web app feature-detects `window.wattroom`
// and falls back to browser behaviour when it is absent, so there is no
// version negotiation and no build in which shell and app can disagree. That
// only holds while this surface stays small enough to reason about.
//
// This runs SANDBOXED, which is what makes it safe and also what constrains
// it: `require` reaches electron and a short allowlist, not the filesystem.
// Reading the version out of package.json here throws, the preload aborts,
// and `window.wattroom` silently never exists — the app then degrades to
// browser behaviour with nothing logged anywhere. So main passes the version
// in as a switch instead, and smoke.spec.js asserts the keys.

const { contextBridge, ipcRenderer } = require('electron');

const arg = (name) =>
	process.argv.find((a) => a.startsWith(`--wattroom-${name}=`))?.split('=')[1];
const version = arg('version') ?? '0.0.0';
// The OS title bar is hidden; this is the height of the strip the app draws
// in its place (#1188). Absent in a browser, which keeps its own chrome.
const titleBar = Number(arg('titlebar')) || 0;

contextBridge.exposeInMainWorld('wattroom', {
	version,
	platform: process.platform,
	titleBar,
	retry: () => ipcRenderer.send('wattroom:retry'),
	// Held for a ride's duration by workout/wakelock.ts. The browser's own wake
	// lock keeps the screen on; this keeps the machine from sleeping under it.
	keepAwake: (on) => ipcRenderer.send('wattroom:keep-awake', on),
	// The floating HUD (ADR-0041): opened by the layout when a ride starts,
	// closed when it ends or from the HUD's own close button.
	hud: (on) => ipcRenderer.send('wattroom:hud', on),
});
