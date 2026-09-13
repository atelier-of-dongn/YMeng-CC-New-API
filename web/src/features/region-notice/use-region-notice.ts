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
import { useCallback, useEffect, useState } from 'react'

import { getRegionNotice } from './api'

// 记录用户勾选"本日不再提醒"的日期。未勾选时不写入，因此每次刷新都会提示。
const SNOOZE_STORAGE_KEY = 'region_notice_snooze_date'

/** 取本地时区的日期字符串（YYYY-MM-DD）。用本地日期而非 UTC，符合用户对"今天"的直觉。 */
function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function isSnoozedToday(): boolean {
  try {
    return window.localStorage.getItem(SNOOZE_STORAGE_KEY) === today()
  } catch {
    // localStorage 不可用时退化为每次都提示，宁可多提醒也不要静默隐藏。
    return false
  }
}

function snoozeForToday() {
  try {
    window.localStorage.setItem(SNOOZE_STORAGE_KEY, today())
  } catch {
    /* 无法持久化时忽略，下次刷新会再次提示 */
  }
}

export function useRegionNotice() {
  const { data } = useQuery({
    queryKey: ['region-notice'],
    queryFn: getRegionNotice,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const [open, setOpen] = useState(false)
  // 本次页面生命周期内是否已关闭过，避免关闭后因数据刷新再次弹出。
  const [closedThisVisit, setClosedThisVisit] = useState(false)

  useEffect(() => {
    if (!data || closedThisVisit) return
    // 未受限说明当前来源能看到全量模型，无需打扰。
    if (!data.restricted) return
    if (data.overseas_only_models.length === 0) return
    if (isSnoozedToday()) return
    setOpen(true)
  }, [data, closedThisVisit])

  /**
   * 关闭弹窗。dontRemindToday 为真时记录当天日期，当日不再提示；
   * 否则不留痕迹，下次刷新继续提示。
   */
  const close = useCallback((dontRemindToday: boolean) => {
    if (dontRemindToday) snoozeForToday()
    setClosedThisVisit(true)
    setOpen(false)
  }, [])

  return { notice: data, open, close }
}