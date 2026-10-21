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
import { useTranslation } from 'react-i18next'
import { RiQqFill } from 'react-icons/ri'

import { cn } from '@/lib/utils'

interface CommunityChatPreviewProps {
  className?: string
}

// A looping peek at a group chat, shown in the wide end of the community
// slice. Purely decorative: its messages are examples, not content.
export function CommunityChatPreview(props: CommunityChatPreviewProps) {
  const { t } = useTranslation()

  const messages = [
    { own: false, text: t('When is the new Claude model coming?') },
    { own: true, text: t('Already live, try it in the console') },
  ]

  return (
    <div
      aria-hidden
      className={cn(
        'rounded-xl border border-sky-500/15 bg-white/75 p-2 shadow-[0_18px_40px_-30px_rgba(18,183,245,0.8)] backdrop-blur-sm dark:border-sky-400/15 dark:bg-[#0b0f17]/80',
        props.className
      )}
    >
      <div className='flex items-center gap-1.5'>
        <span className='size-1.5 rounded-full bg-emerald-500' />
        <span className='font-mono text-[10px] tracking-[0.16em] text-sky-600 uppercase dark:text-sky-400'>
          QQ Group
        </span>
      </div>
      <div className='home-qq-chat mt-1 flex h-[3.25rem] flex-col justify-end gap-1 overflow-hidden'>
        {messages.map((message, index) => (
          <div
            key={message.text}
            className={cn(
              'home-qq-bubble flex shrink-0 items-center gap-1.5 opacity-0',
              message.own && 'flex-row-reverse'
            )}
            style={{ animationDelay: `${index * 1.5}s` }}
          >
            <span
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white',
                message.own ? 'bg-[#12b7f5]' : 'bg-slate-400/80'
              )}
            >
              {message.own ? <RiQqFill className='size-3' /> : '群'}
            </span>
            <span
              className={cn(
                'max-w-[13.5rem] truncate rounded-lg px-2 py-1 text-[11px]',
                message.own
                  ? 'rounded-tr-sm bg-[#12b7f5]/12 text-sky-800 dark:text-sky-200'
                  : 'rounded-tl-sm bg-slate-500/10 text-slate-600 dark:text-slate-300'
              )}
            >
              {message.text}
            </span>
          </div>
        ))}
        <div
          className='home-qq-bubble flex shrink-0 items-center gap-1.5 opacity-0'
          style={{ animationDelay: '3s' }}
        >
          <span className='flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-400/80 text-[9px] font-semibold text-white'>
            群
          </span>
          <span className='flex items-center gap-1 rounded-lg rounded-tl-sm bg-slate-500/10 px-2 py-1.5'>
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className='home-qq-typing size-1 rounded-full bg-slate-400'
                style={{ animationDelay: `${dot * 0.2}s` }}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  )
}
