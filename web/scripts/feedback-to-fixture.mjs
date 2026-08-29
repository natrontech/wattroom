#!/usr/bin/env node
// Converts a captured trace into a committed replay fixture (#54, ADR-0006):
// a feedback report's buffer, or a .hwlog session — identity stripped, the
// numeric series kept. The fixture is what makes a report cheap to fix: the
// agent reproducing the bug produces the screenshot, not the rider.
//
//   node scripts/feedback-to-fixture.mjs <in.jsonl|report.json> <name> [maxSamples]
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, name, max = '300'] = process.argv;
if (!input || !name) {
	console.error('usage: feedback-to-fixture.mjs <in.jsonl|report.json> <name> [maxSamples]');
	process.exit(1);
}

const raw = readFileSync(input, 'utf8');
let samples = [];

for (const line of raw.split('\n')) {
	if (!line.trim()) continue;
	let parsed;
	try {
		parsed = JSON.parse(line);
	} catch {
		continue;
	}
	// hwlog shape: {"kind":"sample","watts":..,"cadence":..}
	if (parsed.kind === 'sample') {
		samples.push({
			watts: Math.max(0, Math.round(parsed.watts ?? 0)),
			cadence: Math.max(0, Math.round(parsed.cadence ?? 0)),
			hr: Math.max(0, Math.round(parsed.hr ?? 0)),
		});
	}
	// feedback report shape: {"report":{"buffer":{"ticks":[...]}}}
	const ticks = parsed.report?.buffer?.ticks;
	if (Array.isArray(ticks)) {
		for (const t of ticks) {
			samples.push({
				watts: Math.max(0, Math.round(t.watts ?? 0)),
				cadence: Math.max(0, Math.round(t.cadence ?? 0)),
				hr: Math.max(0, Math.round(t.heartRate ?? 0)),
			});
		}
	}
}

samples = samples.slice(0, Number(max));
if (samples.length === 0) {
	console.error('no samples found in', input);
	process.exit(1);
}
// Identity never crosses: only the three numbers survive.
writeFileSync(
	`static/fixtures/${name}.json`,
	JSON.stringify({ name, samples }, null, 1) + '\n',
);
console.log(`static/fixtures/${name}.json — ${samples.length} samples`);
