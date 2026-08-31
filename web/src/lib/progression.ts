/**
 * The progression API's shapes and copy, shared by /history, profile and home
 * (#222). One fetch, one vocabulary — zone sentences describe the day, never
 * the rider (ADR-0014's tone rule), and every claim is WattRoom-rides-only.
 */
import { api } from './api';
import type { Focus } from './workout/library';

export interface Curve {
	best5s: number;
	best1m: number;
	best5m: number;
	best20m: number;
}

export interface TrendRide {
	date: string;
	seconds: number;
	kj: number;
	execution: number;
	ftp: number;
	best20m: number;
}

export interface FormPoint {
	date: string;
	fitness: number;
	fatigue: number;
	form: number;
}

export interface Suggestion {
	intent: string;
	why: string;
}

export interface LoadSummary {
	building: boolean;
	fitness: number;
	fatigue: number;
	formPct: number;
	zone: string;
	series: FormPoint[];
	suggestion?: Suggestion;
}

export interface Progression {
	curve: { d30: Curve; d90: Curve; all: Curve };
	rides: TrendRide[];
	category: string;
	wkg: number;
	load?: LoadSummary;
}

export const FORM_SENTENCES: Record<string, string> = {
	transition: 'fresh but fading — a ride would land well',
	fresh: 'fresh — a good day to go hard',
	grey: 'steady — holding fitness',
	optimal: 'building nicely',
	high_risk: 'big load — recovery is where the gains land',
};

// SPEC's suggestion → workout-focus mapping. A badge, never a gate.
const INTENT_FOCUSES: Record<string, Focus[]> = {
	recover: ['Recovery'],
	restart: ['Recovery', 'Endurance'],
	endurance: ['Endurance'],
	intensity: ['Sweet spot', 'Threshold', 'VO₂ max'],
};

export const suggestedFocuses = (s: Suggestion | undefined | null): Focus[] =>
	s ? (INTENT_FOCUSES[s.intent] ?? []) : [];

export const fetchProgression = () => api<Progression>('/api/progression');
