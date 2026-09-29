// Driving the real app from Electron's main process (#3039): what the scene
// runner and its crowd both do to a window — sign in, call the API as the
// page, press a control by the name a rider reads.
const { load } = require('./sample');

/** The page's own fetch, so the call carries its session cookie. */
async function api(win, method, url, body) {
	return win.webContents.executeJavaScript(`(async () => {
		const res = await fetch(${JSON.stringify(url)}, {
			method: ${JSON.stringify(method)},
			headers: { 'content-type': 'application/json' },
			body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))},
		});
		const text = await res.text();
		let json = null;
		try { json = JSON.parse(text); } catch {}
		return { status: res.status, json };
	})()`);
}

/** Like `api`, and throws on a refusal with what the server said. */
async function must(win, method, url, body, what) {
	const res = await api(win, method, url, body);
	if (res.status >= 400)
		throw new Error(`${what}: ${res.status} ${JSON.stringify(res.json)}`);
	return res.json;
}

/**
 * Press the control whose accessible name or text is `label`, once it
 * exists and is enabled. A control that never appears is a failed run, not
 * a silent one.
 */
async function press(win, label, timeoutMs = 20_000) {
	const found = await win.webContents.executeJavaScript(`(async () => {
		const want = ${JSON.stringify(label)};
		const deadline = Date.now() + ${timeoutMs};
		while (Date.now() < deadline) {
			const el = [...document.querySelectorAll('button, a')].find(
				(e) =>
					!e.disabled &&
					(e.getAttribute('aria-label') === want || e.textContent.trim() === want),
			);
			if (el) { el.click(); return true; }
			await new Promise((r) => setTimeout(r, 200));
		}
		return false;
	})()`);
	if (!found)
		throw new Error(`no "${label}" control on ${win.webContents.getURL()}`);
}

/**
 * Dev sign-in as `name`, then mute before anything plays (AGENTS.md): all
 * four mixer channels in one object, because what is stored replaces what
 * was there. Dark theme, as the glow only draws there.
 */
async function signIn(win, base, name) {
	await load(win, `${base}/api/auth/dev/start?as=${encodeURIComponent(name)}`);
	await win.webContents.executeJavaScript(`
		localStorage.setItem('wattroom.mixer.v1', JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }));
		localStorage.setItem('wattroom.theme.v1', 'dark');
	`);
	const me = await must(win, 'GET', '/api/me', undefined, `${name}'s sign-in`);
	if (me.displayName !== name)
		throw new Error(
			`dev sign-in as ${name} landed as ${me.displayName} — is WATTROOM_DEV_LOGIN set on the server?`,
		);
	return me;
}

/** The fake camera, and no permission prompt. The microphone is VOICE's. */
function fakeMedia(app) {
	app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
	app.commandLine.appendSwitch('use-fake-device-for-media-stream');
}

/**
 * Every window's microphone, in the page before it joins voice: silent until
 * window.__perfSpeak is set, then talking in bursts, so the roster's speaking
 * pulse and the tile's ring follow what LiveKit hears. Chromium's own fake
 * device beeps, and the sandboxed audio service cannot read a silent file.
 */
const VOICE = `{
	window.__perfSpeak = false;
	const realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
	navigator.mediaDevices.getUserMedia = async (constraints) => {
		if (!constraints?.audio) return realGetUserMedia(constraints);
		const ctx = new AudioContext();
		const osc = ctx.createOscillator(); osc.frequency.value = 180;
		const gain = ctx.createGain(); gain.gain.value = 0;
		const out = ctx.createMediaStreamDestination();
		osc.connect(gain).connect(out); osc.start();
		(function burst() {
			const on = window.__perfSpeak && Math.random() < 0.75;
			gain.gain.setTargetAtTime(on ? 0.4 : 0, ctx.currentTime, 0.02);
			setTimeout(burst, on ? 900 + Math.random() * 1200 : 300 + Math.random() * 400);
		})();
		return out.stream;
	};
}
undefined;`;

module.exports = { api, must, press, signIn, fakeMedia, VOICE };
