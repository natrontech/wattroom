// The permission gate (permissions.js), without Electron: attach() only calls
// three setters on the window's session, so a session that records them is
// enough, and Playwright's runner tests the handlers as plain Node.
const { test, expect } = require('@playwright/test');
const permissions = require('./permissions');

const APP_ORIGIN = 'https://wattroom.ch';
const isOurs = (url) => {
	try {
		return new URL(url).origin === APP_ORIGIN;
	} catch {
		return false;
	}
};

function handlers() {
	const seen = {};
	const session = {
		setPermissionRequestHandler: (fn) => (seen.request = fn),
		setPermissionCheckHandler: (fn) => (seen.check = fn),
		setDisplayMediaRequestHandler: () => {},
	};
	permissions.install({ isOurs });
	permissions.attach({ webContents: { session } });
	return seen;
}

// What Electron passes is the frame's origin as a URL, "https://wattroom.ch/"
// with the slash (web_contents_permission_helper.cc: GetLastCommittedOrigin()
// .GetURL(), handed to JS as its spec). enumerateDevices asks this before it
// names a device, and a strict string compare refused every check, so the
// pickers listed nothing but "System default".
test('the check allows our origin the mic and camera, as Electron spells it', () => {
	const { check } = handlers();
	for (const mediaType of ['audio', 'video'])
		expect(check(null, 'media', `${APP_ORIGIN}/`, { mediaType })).toBe(true);
	expect(check(null, 'notifications', `${APP_ORIGIN}/`, {})).toBe(true);
});

test('the check refuses another origin, the player frame, and what is not on the list', () => {
	const { check } = handlers();
	expect(check(null, 'media', 'https://www.youtube-nocookie.com/', {})).toBe(false);
	expect(check(null, 'media', 'https://wattroom.ch.evil.example/', {})).toBe(false);
	expect(check(null, 'media', '', {})).toBe(false);
	expect(check(null, 'geolocation', `${APP_ORIGIN}/`, {})).toBe(false);
});

test('a request is decided on the frame that asks', () => {
	const { request } = handlers();
	const ask = (requestingUrl, permission = 'media') =>
		new Promise((resolve) =>
			request({ getURL: () => `${APP_ORIGIN}/c/mfw` }, permission, resolve, {
				requestingUrl,
			}),
		);
	return Promise.all([
		expect(ask(`${APP_ORIGIN}/c/mfw`)).resolves.toBe(true),
		expect(ask('https://www.youtube-nocookie.com/embed/x')).resolves.toBe(false),
		expect(ask(`${APP_ORIGIN}/c/mfw`, 'geolocation')).resolves.toBe(false),
	]);
});
