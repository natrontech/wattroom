// What a built installer carries (#3508), read back off its app.asar.
//
// electron-builder packs only package.json's build.files, and a module that
// main.js requires but the list leaves out ships an app that throws before
// `whenReady` — no window, no tray, and no self-update to get out of it,
// on every platform at once. files.spec.js checks the list in the desktop
// job, which is advisory; this is the release refusing the build itself.
//
// Run: `node asar-check.js <app.asar>` after `electron-builder`. Reads the
// archive's own header, so it needs nothing installed. Not packaged.
const fs = require('node:fs');
const { reached } = require('./reached');

/** Every file path in an asar archive: its header is a JSON tree after a 16-byte Pickle prefix. */
function listAsar(file) {
	const head = Buffer.alloc(16);
	const fd = fs.openSync(file, 'r');
	try {
		fs.readSync(fd, head, 0, 16, 0);
		const json = Buffer.alloc(head.readUInt32LE(12));
		fs.readSync(fd, json, 0, json.length, 16);
		const out = [];
		const walk = (node, at) => {
			for (const [name, child] of Object.entries(node.files ?? {}))
				if (child.files) walk(child, `${at}${name}/`);
				else out.push(`${at}${name}`);
		};
		walk(JSON.parse(json.toString('utf8')), '');
		return out;
	} finally {
		fs.closeSync(fd);
	}
}

/** What the shell loads and the archive does not hold. */
const missingFrom = (asar) => {
	const inside = new Set(listAsar(asar));
	return reached().filter((f) => !inside.has(f));
};

if (require.main === module) {
	const missing = missingFrom(process.argv[2]);
	if (missing.length > 0) {
		console.error(
			`${process.argv[2]} leaves out ${missing.join(', ')} — add them to build.files in desktop/package.json`,
		);
		process.exit(1);
	}
	console.log(`${process.argv[2]} carries all ${reached().length} files the shell loads`);
}

module.exports = { listAsar, missingFrom };
