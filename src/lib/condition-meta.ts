import type { ConditionType } from './types';

// Shared presentation metadata for condition types — emoji + human label.
// Centralized here so later components (map markers, condition lists, filters)
// don't each inline their own copy of this mapping.
export const CONDITION_META: Record<ConditionType, { emoji: string; label: string }> = {
	landscaping: { emoji: '🌳', label: 'Landscaping' },
	bike_parking: { emoji: '🚲', label: 'Bike parking' },
	public_art: { emoji: '🎨', label: 'Public art' },
	street_furniture: { emoji: '🪑', label: 'Street furniture' },
	pavers: { emoji: '🧱', label: 'Pavers' }
};
