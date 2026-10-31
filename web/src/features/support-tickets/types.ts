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
export type SupportTicketStatus = 'pending' | 'replied'
export type SupportTicketScope = 'self' | 'admin'
export type SupportTicketAuthorRole = 'user' | 'admin'

export type SupportTicketRequestLog = {
  request_id: string
  created_at: number
  type: number
  model_name: string
  content: string
}

export type SupportTicket = {
  id: number
  user_id: number
  username: string
  status: SupportTicketStatus
  request_id: string
  created_at: number
  updated_at: number
  last_message_at: number
  preview: string
  has_attachment: boolean
  request_log?: SupportTicketRequestLog | null
  messages?: SupportTicketMessage[]
}

export type SupportTicketMessage = {
  id: number
  author_username: string
  role: SupportTicketAuthorRole
  content: string
  created_at: number
  has_attachment?: boolean
  attachment_name?: string
  attachment_size?: number
}

export type SupportTicketListFilters = {
  status: SupportTicketStatus | ''
  username: string
  request_id: string
}

export type SupportTicketPage = {
  items: SupportTicket[]
  total: number
}

export type ApiResponse<T> = {
  success: boolean
  message: string
  data: T
}
