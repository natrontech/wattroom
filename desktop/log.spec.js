// The shell's log file (#3012), without Electron: log.js takes a path, so
// Playwright's runner tests it as plain Node. smoke.spec.js checks main.js
// wires it in.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const log = require('./log');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wattroom-log-'));

test('a warning still prints, and lands in the file with the time', () => {
	const file = path.join(tmp(), 'logs', 'main.log');
	const printed = [];
	const warn = console.warn;
	const error = console.error;
	console.warn = (...a) => printed.push(a.join(' '));
	console.error = (...a) => printed.push(a.join(' '));
	try {
		log.teeConsole(file);
		console.warn('update check failed:', 'ENOTFOUND');
		console.error('renderer gone: %s', 'crashed');
	} finally {
		console.warn = warn;
		console.error = error;
	}
	expect(printed).toEqual(['update check failed: ENOTFOUND', 'renderer gone: %s crashed']);
	const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
	expect(lines).toHaveLength(2);
	expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z warn update check failed: ENOTFOUND$/);
	expect(lines[1]).toMatch(/Z error renderer gone: crashed$/);
});

test('past the cap the file moves aside once, and a fresh one starts', () => {
	const dir = tmp();
	const file = path.join(dir, 'main.log');
	fs.writeFileSync(file, 'x'.repeat(log.CAP + 1));
	log.append(file, 'after\n');
	expect(fs.readFileSync(file, 'utf8')).toBe('after\n');
	expect(fs.statSync(path.join(dir, 'main.old.log')).size).toBe(log.CAP + 1);
});

test('a log it cannot write never throws', () => {
	const file = path.join(tmp(), 'not-a-dir');
	fs.writeFileSync(file, '');
	expect(() => log.append(path.join(file, 'main.log'), 'lost\n')).not.toThrow();
});
