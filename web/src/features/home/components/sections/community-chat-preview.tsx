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
import type { IconType } from 'react-icons'
import { FaTelegram } from 'react-icons/fa'
import { RiQqFill } from 'react-icons/ri'

import { useStatus } from '@/hooks/use-status'
import { cn } from '@/lib/utils'

interface CommunityChatPreviewProps {
  className?: string
}

interface ChatRound {
  name: string
  icon: IconType
  accentClassName: string
  messages: string[]
}

// A looping peek at the group chats, shown in the wide end of the community
// slice. Purely decorative: its messages are examples, not content. Each
// platform gets its own round (question, answer, typing) and the rounds take
// turns, so the two groups read as separate conversations.
export function CommunityChatPreview(props: CommunityChatPreviewProps) {
  const { t } = useTranslation()
  const { status } = useStatus()

  const qqLink = (
    (status?.community_qq_group_link as string | undefined) ?? ''
  ).trim()
  const telegramLink = (
    (status?.community_telegram_link as string | undefined) ?? ''
  ).trim()

  const rounds: ChatRound[] = []
  if (qqLink) {
    rounds.push({
      name: 'QQ',
      icon: RiQqFill,
      accentClassName: 'bg-[#12b7f5] text-white',
      messages: [
        t('How do I connect this model?'),
        t('Grab a key in the console and paste it into your client'),
      ],
    })
  }
  if (telegramLink) {
    rounds.push({
      name: 'Telegram',
      icon: FaTelegram,
      accentClassName: 'bg-[#229ED9] text-white',
      messages: [
        t('How do I report an error?'),
        t('Post the logs in the group and we will take a look'),
      ],
    })
  }

  if (rounds.length === 0) return null

  const rotating = rounds.length > 1

  return (
    <div
      aria-hidden
      className={cn(
        'w-full rounded-xl border border-sky-500/15 bg-white/75 p-2 shadow-[0_18px_40px_-30px_rgba(18,183,245,0.8)] backdrop-blur-sm dark:border-sky-400/15 dark:bg-[#0b0f17]/80',
        props.className
      )}
    >
      <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
        {rounds.map((round, index) => {
          const Icon = round.icon
          return (
            <span
              key={round.name}
              className='flex items-center gap-1.5'
              data-platform={round.name}
            >
              {index > 0 && (
                <span className='text-[10px] text-slate-400' aria-hidden>
                  ·
                </span>
              )}
              <span className='size-1.5 rounded-full bg-emerald-500' />
              <Icon className='size-3.5 text-slate-500 dark:text-slate-400' />
              <span className='font-mono text-[10px] tracking-[0.16em] text-sky-600 uppercase dark:text-sky-400'>
                {round.name}
              </span>
            </span>
          )
        })}
      </div>

      <div
        className={cn(
          'home-chat-rounds grid min-w-0',
          rotating ? 'home-chat-rotating' : 'home-chat-static'
        )}
      >
        {rounds.map((round) => {
          const Icon = round.icon
          return (
            <div
              key={round.name}
              className={cn(
                'home-qq-round col-start-1 row-start-1 flex min-w-0 flex-col gap-1 pt-2',
                rotating &&
                  round.name === rounds[1].name &&
                  'home-qq-round-late'
              )}
            >
              {round.messages.map((message, index) => {
                const own = index === 1
                return (
                  <div
                    key={message}
                    className={cn(
                      'home-qq-bubble flex min-w-0 items-start gap-1.5',
                      own && 'home-chat-answer flex-row-reverse'
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold',
                        own
                          ? round.accentClassName
                          : 'bg-slate-400/80 text-white'
                      )}
                    >
                      <Icon className={own ? 'size-3' : 'size-2.5'} />
                    </span>
                    <span
                      className={cn(
                        'min-w-0 max-w-[calc(100%-1.625rem)] rounded-lg px-2 py-1 text-[11px] leading-relaxed break-words',
                        own
                          ? 'rounded-tr-sm bg-[#12b7f5]/12 text-sky-800 dark:text-sky-200'
                          : 'rounded-tl-sm bg-slate-500/10 text-slate-600 dark:text-slate-300'
                      )}
                    >
                      {message}
                    </span>
                  </div>
                )
              })}
              <div className='home-qq-bubble home-chat-typing-row flex min-w-0 items-start gap-1.5'>
                <span className='flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-400/80 text-white'>
                  <Icon className='size-2.5' />
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
          )
        })}
      </div>
    </div>
  )
}
