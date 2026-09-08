// The shell's smoke config (#296). Deliberately separate from web/'s: that
// suite drives a browser build through a dev server, this one launches a
// packaged-shaped Electron app and has no server, no baseURL and no browser
// project. Sharing one config would mean one of them carrying options the
// other must ignore.
module.exports = {
	testDir: '.',
	testMatch: 'smoke.spec.js',
	// Each test launches its own Electron; the app takes a single-instance
	// lock, so a second one would quit immediately instead of failing loudly.
	workers: 1,
	timeout: 60_000,
	reporter: process.env.CI ? 'github' : 'list',
};
