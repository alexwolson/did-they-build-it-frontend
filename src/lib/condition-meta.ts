import type { Component } from 'svelte';
import type { ConditionType } from './types';
import Bicycle from 'phosphor-svelte/lib/Bicycle';
import Tree from 'phosphor-svelte/lib/Tree';
import Palette from 'phosphor-svelte/lib/Palette';
import Armchair from 'phosphor-svelte/lib/Armchair';
import SquaresFour from 'phosphor-svelte/lib/SquaresFour';
import Park from 'phosphor-svelte/lib/Park';
import Info from 'phosphor-svelte/lib/Info';

// Shared presentation for condition types — a Phosphor icon (no emoji, app-wide)
// plus a human label. Icons are Svelte components; render with weight="duotone".
// Centralized so map markers, condition cards, and lists all use one source.
export const CONDITION_META: Record<ConditionType, { label: string; icon: Component }> = {
	landscaping: { label: 'Landscaping', icon: Tree },
	bike_parking: { label: 'Bike parking', icon: Bicycle },
	public_art: { label: 'Public art', icon: Palette },
	street_furniture: { label: 'Street furniture', icon: Armchair },
	pavers: { label: 'Pavers', icon: SquaresFour },
	open_space: { label: 'Open space', icon: Park },
	other: { label: 'Other', icon: Info }
};

// Commitment-strength badge text, keyed by the condition's `source`.
export const SOURCE_LABEL: Record<string, string> = {
	staff_report_condition: 'Condition of approval',
	section_37: 'Secured community benefit',
	proposed_and_approved: 'Approved proposal'
};
