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

export type AffiliateSummary = {
  invitee_count: number
  commission_count: number
  available_quota: number
  total_quota: number
  pending_remainder: number
  rate_percent: number
  enabled: boolean
  aff_code: string
}

export type AffiliateCommissionItem = {
  id: number
  invitee_id: number
  invitee_name: string
  model_name: string
  billing_source: string
  consumed_quota: number
  rate_percent: number
  reward_amount: number
  credited_quota: number
  status: string
  created_at: number
}

export type AffiliateInviteeItem = {
  user_id: number
  display_name: string
  masked_email: string
  commission_count: number
  credited_quota: number
  consumed_quota: number
  last_reward_at: number
  registered_at: number
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

export async function getAffiliateSummary(): Promise<AffiliateSummary> {
  const { data } = await api.get<ApiEnvelope<AffiliateSummary>>(
    '/api/user/affiliate/summary'
  )
  return data.data
}

export async function getAffiliateCommissions(
  page: number,
  pageSize: number
): Promise<Paged<AffiliateCommissionItem>> {
  const { data } = await api.get<ApiEnvelope<Paged<AffiliateCommissionItem>>>(
    '/api/user/affiliate/commissions',
    { params: { page, page_size: pageSize } }
  )
  return data.data
}

export async function getAffiliateInvitees(
  page: number,
  pageSize: number
): Promise<Paged<AffiliateInviteeItem>> {
  const { data } = await api.get<ApiEnvelope<Paged<AffiliateInviteeItem>>>(
    '/api/user/affiliate/invitees',
    { params: { page, page_size: pageSize } }
  )
  return data.data
}