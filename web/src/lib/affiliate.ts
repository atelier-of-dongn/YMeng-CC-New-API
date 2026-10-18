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
/**
 * 推广注册链接的唯一生成入口。
 *
 * 钱包页与推广页共用此函数，避免两处各自拼接导致链接不一致。
 * 目标固定为 /sign-up：/register 只是重定向到它，直接用会多一次跳转。
 */
export function generateAffiliateLink(affCode: string): string {
  if (typeof window === 'undefined') return ''
  if (!affCode) return ''
  return `${window.location.origin}/sign-up?aff=${encodeURIComponent(affCode)}`
}