// The fuses #3009 flips, read back off a built app.
//
// With RunAsNode, NODE_OPTIONS or --inspect left on, any local process can
// run its own code AS the signed WattRoom app — and inherit the camera,
// microphone and Bluetooth the rider granted it. electron-builder flips them
// from package.json's `electronFuses`, and a key it stops reading ships an
// unlocked build with no error anywhere. So the release refuses one.
//
// Run: `node fuses-check.js <app>` after `electron-builder`, with the .app on
// macOS or the executable elsewhere. Not packaged (package.json `files`).
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
// Not re-exported from the package root.
const { FuseState } = require('@electron/fuses/dist/constants');

const OFF = [
	'RunAsNode',
	'EnableNodeOptionsEnvironmentVariable',
	'EnableNodeCliInspectArguments',
];

getCurrentFuseWire(process.argv[2]).then((wire) => {
	const on = OFF.filter((f) => wire[FuseV1Options[f]] !== FuseState.DISABLE);
	if (on.length > 0) {
		console.error(`fuses still on in ${process.argv[2]}: ${on.join(', ')}`);
		process.exit(1);
	}
	console.log(`fuses off: ${OFF.join(', ')}`);
});
