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

export type AffiliateAnalyticsRange = {
  start_timestamp: number
  end_timestamp: number
}

export type AffiliateAnalyticsOverview = {
  referral_count: number
  active_inviter_count: number
  commission_count: number
  credited_quota: number
}

export type AffiliateAnalyticsTrend = {
  date: string
  referral_count: number
  commission_count: number
  credited_quota: number
}

export type AffiliateAnalyticsRanking = {
  inviter_id: number
  username: string
  display_name: string
  referral_count: number
  commission_count: number
  credited_quota: number
}

export type AffiliateAnalyticsCommission = {
  id: number
  inviter_id: number
  inviter_name: string
  invitee_id: number
  invitee_name: string
  model_name: string
  billing_source: string
  consumed_quota: number
  rate_percent: number
  reward_amount: number
  credited_quota: number
  status: 'completed' | 'pending' | 'failed'
  created_at: number
}

type ApiEnvelope<T> = {
  success: boolean
  message: string
  data: T
}

type Paged<T> = {
  items: T[]
  total: number
}

export async function getAffiliateAnalyticsOverview(
  range: AffiliateAnalyticsRange
) {
  const { data } = await api.get<
    ApiEnvelope<{
      overview: AffiliateAnalyticsOverview
      trend: AffiliateAnalyticsTrend[]
    }>
  >('/api/affiliate/analytics/admin/overview', { params: range })
  return data
}

export async function getAffiliateAnalyticsRankings(params: {
  range: AffiliateAnalyticsRange
  keyword?: string
  page: number
  page_size: number
}) {
  const { data } = await api.get<ApiEnvelope<Paged<AffiliateAnalyticsRanking>>>(
    '/api/affiliate/analytics/admin/rankings',
    {
      params: {
        ...params.range,
        keyword: params.keyword,
        page: params.page,
        page_size: params.page_size,
      },
    }
  )
  return data
}

export async function getAffiliateAnalyticsCommissions(params: {
  range: AffiliateAnalyticsRange
  keyword?: string
  status?: string
  page: number
  page_size: number
}) {
  const { data } = await api.get<
    ApiEnvelope<Paged<AffiliateAnalyticsCommission>>
  >('/api/affiliate/analytics/admin/commissions', {
    params: {
      ...params.range,
      keyword: params.keyword,
      status: params.status,
      page: params.page,
      page_size: params.page_size,
    },
  })
  return data
}
