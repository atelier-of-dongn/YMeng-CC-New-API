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
import { api } from '@/lib/api'

export type RegionModelEntry = {
  model_name: string
  groups: string[]
}

export type RegionNotice = {
  restricted: boolean
  country: string
  allowed_groups: string[]
  restricted_groups: string[]
  available_models: RegionModelEntry[]
  overseas_only_models: RegionModelEntry[]
  available_model_count: number
  overseas_model_count: number
  total_model_count: number
}

type RegionNoticeResponse = {
  success: boolean
  message: string
  data: RegionNotice
}

/**
 * 读取当前访问来源的模型可见性说明。
 * 该接口为纯展示用途，失败时不应打断页面渲染，因此关闭统一错误提示。
 */
export async function getRegionNotice(): Promise<RegionNotice> {
  const { data } = await api.get<RegionNoticeResponse>(
    '/api/ip-access-policy/notice',
    { skipErrorHandler: true, skipBusinessError: true }
  )
  return data.data
}