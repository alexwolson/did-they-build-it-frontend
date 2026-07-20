import type { Component } from 'svelte';
import type { ConditionType } from './types';
import Bicycle from 'phosphor-svelte/lib/Bicycle';
import Tree from 'phosphor-svelte/lib/Tree';
import Palette from 'phosphor-svelte/lib/Palette';
import Armchair from 'phosphor-svelte/lib/Armchair';
import SquaresFour from 'phosphor-svelte/lib/SquaresFour';

// Shared presentation for condition types — a Phosphor icon (no emoji, app-wide)
// plus a human label. Icons are Svelte components; render with weight="duotone".
// Centralized so map markers, condition cards, and lists all use one source.
export const CONDITION_META: Record<ConditionType, { label: string; icon: Component }> = {
	landscaping: { label: 'Landscaping', icon: Tree },
	bike_parking: { label: 'Bike parking', icon: Bicycle },
	public_art: { label: 'Public art', icon: Palette },
	street_furniture: { label: 'Street furniture', icon: Armchair },
	pavers: { label: 'Pavers', icon: SquaresFour }
};
