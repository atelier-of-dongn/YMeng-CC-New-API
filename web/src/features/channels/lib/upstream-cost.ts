/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { z } from 'zod'

import type { StatusVariant } from '@/components/status-badge'

import type {
  UpstreamGroupOption,
  UpstreamMonitorView,
  UpstreamPriceBasis,
} from '../types'

/** `label` is an i18n key; render it with `t(display.label)`. */
export type UpstreamStatusDisplay = {
  label: string
  variant: StatusVariant
}

const UNKNOWN_STATUS_DISPLAY: UpstreamStatusDisplay = {
  label: 'Unknown',
  variant: 'neutral',
}

const UPSTREAM_COST_STATUS_DISPLAY: Record<string, UpstreamStatusDisplay> = {
  normal: { label: 'Normal', variant: 'success' },
  ratio_changed: { label: 'Ratio changed', variant: 'warning' },
  inverted: { label: 'Inverted', variant: 'danger' },
  group_offline: { label: 'Group offline', variant: 'danger' },
  unknown: { label: 'Unrecognized', variant: 'neutral' },
}

const UPSTREAM_SITE_STATUS_DISPLAY: Record<string, UpstreamStatusDisplay> = {
  pending: { label: 'Detecting', variant: 'info' },
  newapi: { label: 'New API', variant: 'success' },
  unsupported: { label: 'Unsupported', variant: 'warning' },
  unreachable: { label: 'Unreachable', variant: 'danger' },
}

const UPSTREAM_PRICING_STATUS_DISPLAY: Record<string, UpstreamStatusDisplay> = {
  ok: { label: 'Pricing synced', variant: 'success' },
  groups_only: { label: 'Groups only', variant: 'warning' },
  error: { label: 'Pricing error', variant: 'danger' },
}

const UPSTREAM_RATIO_SOURCE_LABELS: Record<string, string> = {
  pricing: 'Upstream pricing',
  log: 'Upstream logs',
  manual: 'Manual',
}

const UPSTREAM_PRICE_BASIS_LABELS: Record<UpstreamPriceBasis, string> = {
  input: 'Input',
  output: 'Output',
  per_call: 'Per-call',
}

/** Inverted-model lists inside tooltips are capped to keep them readable. */
export const MAX_UPSTREAM_TOOLTIP_MODELS = 8

export const UPSTREAM_COST_FACTOR_MAX = 100

function lookupStatus<T>(
  table: Record<string, T>,
  key: string | null | undefined
): T | undefined {
  if (!key || !Object.hasOwn(table, key)) return undefined
  return table[key]
}

/** Unexpected backend values fall back to the "unrecognized" state. */
export function getUpstreamCostStatusDisplay(
  status: string | null | undefined
): UpstreamStatusDisplay {
  return (
    lookupStatus(UPSTREAM_COST_STATUS_DISPLAY, status) ??
    UPSTREAM_COST_STATUS_DISPLAY.unknown
  )
}

export function getUpstreamSiteStatusDisplay(
  status: string | null | undefined
): UpstreamStatusDisplay {
  return (
    lookupStatus(UPSTREAM_SITE_STATUS_DISPLAY, status) ?? UNKNOWN_STATUS_DISPLAY
  )
}

/** Returns null when the pricing endpoint has not been fetched yet. */
export function getUpstreamPricingStatusDisplay(
  status: string | null | undefined
): UpstreamStatusDisplay | null {
  if (!status) return null
  return (
    lookupStatus(UPSTREAM_PRICING_STATUS_DISPLAY, status) ??
    UNKNOWN_STATUS_DISPLAY
  )
}

/** Returns null when the ratio source is unknown. */
export function getUpstreamRatioSourceLabel(
  source: string | null | undefined
): string | null {
  return lookupStatus(UPSTREAM_RATIO_SOURCE_LABELS, source) ?? null
}

export function getUpstreamPriceBasisLabel(basis: UpstreamPriceBasis): string {
  return lookupStatus(UPSTREAM_PRICE_BASIS_LABELS, basis) ?? 'Unknown'
}

/** Input/output prices are compared per 1K tokens, per-call prices per call. */
export function isTokenPriceBasis(basis: UpstreamPriceBasis): boolean {
  return basis === 'input' || basis === 'output'
}

/** Formats a group ratio as `×1.5`; unknown (0 or invalid) ratios become `-`. */
export function formatUpstreamRatio(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return '-'
  const rounded = ratio < 0.0001 ? ratio.toPrecision(2) : ratio.toFixed(4)
  return `×${Number(rounded)}`
}

/** The "Select group" shortcut only helps once the site is known to be New API. */
export function canSelectUpstreamGroup(
  monitor: Pick<UpstreamMonitorView, 'effective_group' | 'site_status'>
): boolean {
  return monitor.effective_group === '' && monitor.site_status === 'newapi'
}

/**
 * Candidate groups for manual selection. A saved manual group that the
 * upstream no longer lists stays selectable so the current value can be shown.
 */
export function getSelectableUpstreamGroups(
  monitor: Pick<UpstreamMonitorView, 'groups' | 'manual_group'>
): UpstreamGroupOption[] {
  const groups = monitor.groups ?? []
  const manualGroup = monitor.manual_group
  if (!manualGroup || groups.some((group) => group.name === manualGroup)) {
    return groups
  }
  return [
    ...groups,
    { name: manualGroup, ratio: 0, public: false, offline: false, desc: '' },
  ]
}

export const upstreamCostFactorSchema = z.coerce
  .number()
  .gt(0)
  .lte(UPSTREAM_COST_FACTOR_MAX)

/** Parses a cost factor input; returns null unless 0 < factor <= 100. */
export function parseUpstreamCostFactor(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const result = upstreamCostFactorSchema.safeParse(trimmed)
  return result.success ? result.data : null
}
