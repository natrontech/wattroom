import type { Workout } from '../types';

/**
 * A file converted into the docs/SPEC.md workout JSON (#2327), plus every
 * line about what the file asked for that our steps cannot say.
 *
 * `notes` is not decoration. WATTROOM.md locks our JSON as the workout model,
 * so an import is a conversion and a conversion loses things — a free-ride
 * block, a mid-ride text prompt, a single cadence where we model a band.
 * "Imported" over a file that quietly lost half its blocks is the same bug as
 * "Something went wrong" (.claude/rules/errors.md), so the surface shows these
 * before the rider saves.
 */
export interface Imported {
	workout: Workout;
	notes: string[];
}

/** Mirrors `Validation` in ../validate: the refusal is the rider's sentence. */
export type ImportOutcome =
	{ ok: true; imported: Imported } | { ok: false; error: string };
