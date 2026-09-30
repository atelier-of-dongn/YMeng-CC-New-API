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
import { useQuery } from '@tanstack/react-query'

import { requireServerSuccess } from '@/lib/server-error-message'

import { getUpstreamSites } from '../api'
import { upstreamCostQueryKeys } from '../lib'

/**
 * Upstream sites shared by the sites dialog and the monitor dialog. Callers
 * present failures inline, so the global error toast is disabled.
 */
export function useUpstreamSites(options: {
  enabled: boolean
  refetchInterval?: number | false
}) {
  return useQuery({
    queryKey: upstreamCostQueryKeys.sites,
    queryFn: async () =>
      requireServerSuccess(await getUpstreamSites()).data ?? [],
    enabled: options.enabled,
    refetchInterval: options.refetchInterval,
    meta: { errorToast: false },
  })
}
