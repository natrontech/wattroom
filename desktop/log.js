// The shell's own log (#3012).
//
// A packaged app's stdout goes nowhere, so every warning the shell prints — an
// update check that failed, a renderer that went away, window state not saved
// — also lands in main.log in the platform's log folder, with the time. Until
// now incident forensics rebuilt a ride from file dates in userData and
// `log show` runningboard entries; a rider can send this file back instead
// (docs/HARDWARE-SESSIONS.md says where it is).

const fs = require('node:fs');
const path = require('node:path');
const { format } = require('node:util');

// ponytail: 1 MB and one older copy — years of warnings; more copies if a crash loop ever fills it faster.
const CAP = 1024 * 1024;

/**
 * One line onto the end of `file`, moving the file aside to .old.log first
 * once it has passed the cap. Never throws: a log that cannot be written must
 * not take the shell down with it.
 */
function append(file, line) {
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		if (fs.existsSync(file) && fs.statSync(file).size > CAP)
			fs.renameSync(file, file.replace(/\.log$/, '.old.log'));
		fs.appendFileSync(file, line);
	} catch {
		// Nowhere left to say so.
	}
}

/** console.warn and console.error go on to `file` as well, each line stamped with the time. */
function teeConsole(file) {
	for (const level of ['warn', 'error']) {
		const print = console[level].bind(console);
		console[level] = (...args) => {
			print(...args);
			append(file, `${new Date().toISOString()} ${level} ${format(...args)}\n`);
		};
	}
	return file;
}

module.exports = { append, teeConsole, CAP };
