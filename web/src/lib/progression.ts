/**
 * The progression API's shapes and copy, shared by /history, profile and home
 * (#222). One fetch, one vocabulary — zone sentences describe the day, never
 * the rider (ADR-0014's tone rule), and every claim is WattRoom-rides-only.
 */
import { api } from './api';

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

export interface LoadSummary {
	building: boolean;
	fitness: number;
	fatigue: number;
	formPct: number;
	zone: string;
	series: FormPoint[];
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

export const fetchProgression = () => api<Progression>('/api/progression');
