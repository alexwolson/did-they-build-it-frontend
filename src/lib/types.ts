export const CONDITION_TYPES = [
	'landscaping',
	'bike_parking',
	'public_art',
	'street_furniture',
	'pavers'
] as const;
export type ConditionType = (typeof CONDITION_TYPES)[number];

export interface SiteCondition {
	key: string; // stable 16-hex condition_key
	type: ConditionType;
	description: string;
	rawText: string;
	sourceUrl: string; // toronto.ca legdocs PDF
}

export interface SiteProperties {
	siteId: string; // slugged aic_ref, e.g. "21-208078-ste-10-oz"
	address: string; // display form, e.g. "147 Spadina Ave"
	aicRef: string;
	ward: string;
	status: string | null; // e.g. "Closed", "Council Approved"
	appliedYear: number | null;
	conditions: SiteCondition[];
}

export interface SiteFeature {
	type: 'Feature';
	geometry: { type: 'Point'; coordinates: [number, number] }; // [lng, lat]
	properties: SiteProperties;
}

export interface SitesCollection {
	type: 'FeatureCollection';
	generated: string; // ISO timestamp of the ETL run
	features: SiteFeature[];
}

export type Verdict = 'present' | 'absent' | 'unclear';
export const VERDICTS: readonly Verdict[] = ['present', 'absent', 'unclear'];

export interface StatusCounts {
	present: number;
	absent: number;
	unclear: number;
	photos: number;
}

export interface SubmissionPayload {
	deviceId: string;
	siteId: string;
	conditionKey: string;
	verdict: Verdict;
	note?: string | null;
	lat?: number | null;
	lng?: number | null;
	accuracyM?: number | null;
}
