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
/* eslint-disable react-refresh/only-export-components */
import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, useMemo, type ReactNode } from 'react'

import { requireServerSuccess } from '@/lib/server-error-message'

import { getUpstreamMonitors } from '../api'
import { upstreamCostQueryKeys } from '../lib'
import type { UpstreamMonitorView } from '../types'

const UPSTREAM_MONITOR_REFETCH_INTERVAL_MS = 60 * 1000

type UpstreamMonitorMap = ReadonlyMap<number, UpstreamMonitorView>

const UpstreamMonitorContext = createContext<UpstreamMonitorMap>(new Map())

type UpstreamMonitorProviderProps = {
  /** Real channel ids on the current page; tag aggregate rows excluded. */
  channelIds: number[]
  children: ReactNode
}

/**
 * Polls upstream monitors for the visible channels and shares them through
 * context, so the memoized column definitions stay independent of monitor data.
 */
export function UpstreamMonitorProvider(props: UpstreamMonitorProviderProps) {
  const { data } = useQuery({
    queryKey: upstreamCostQueryKeys.monitorList(props.channelIds),
    queryFn: async () =>
      requireServerSuccess(await getUpstreamMonitors(props.channelIds)).data ??
      [],
    enabled: props.channelIds.length > 0,
    refetchInterval: UPSTREAM_MONITOR_REFETCH_INTERVAL_MS,
    placeholderData: (previousData) => previousData,
    // Background polling: a failure only leaves the monitor cells empty.
    meta: { errorToast: false },
  })

  const monitors = useMemo<UpstreamMonitorMap>(
    () => new Map((data ?? []).map((monitor) => [monitor.channel_id, monitor])),
    [data]
  )

  return (
    <UpstreamMonitorContext.Provider value={monitors}>
      {props.children}
    </UpstreamMonitorContext.Provider>
  )
}

/** Returns the monitor of a channel, or undefined when it has no monitor row. */
export function useUpstreamMonitor(
  channelId: number
): UpstreamMonitorView | undefined {
  return useContext(UpstreamMonitorContext).get(channelId)
}
