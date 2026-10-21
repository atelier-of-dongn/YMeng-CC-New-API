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
import { ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { RiQqFill } from 'react-icons/ri'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { COMMUNITY_QQ_GROUP_URL } from '../../constants'

interface CommunityCardProps {
  className?: string
}

// The site's QQ group. From lg up it fills the corner the second seam cuts
// off (.home-community-wedge); below lg it is a plain card.
export function CommunityCard(props: CommunityCardProps) {
  const { t } = useTranslation()

  const topics = [t('Q&A'), t('Feedback'), t('New models')]

  return (
    <div
      className={cn(
        'landing-animate-fade-up w-full max-w-md rounded-xl border border-sky-500/15 bg-white/70 p-3 opacity-0 shadow-[0_16px_40px_-28px_rgba(18,183,245,0.6)] backdrop-blur-sm lg:w-auto lg:max-w-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none dark:border-sky-400/15 dark:bg-white/[0.04] dark:lg:bg-transparent',
        props.className
      )}
      style={{ animationDelay: '60ms' }}
    >
      <div className='flex items-center gap-3 lg:gap-4'>
        <span className='relative flex size-14 shrink-0 lg:size-16'>
          <span
            aria-hidden
            className='home-qq-ring absolute inset-0 rounded-2xl border border-sky-400/40'
          />
          <span
            aria-hidden
            className='home-qq-ring absolute inset-0 rounded-2xl border border-sky-400/40 [animation-delay:1.2s]'
          />
          <span className='home-qq-float relative flex size-full items-center justify-center rounded-2xl bg-gradient-to-br from-[#12b7f5] to-[#0a8fd6] text-white shadow-[0_10px_24px_-10px_rgba(18,183,245,0.9)]'>
            <RiQqFill className='size-8 lg:size-9' aria-hidden />
            <span
              className='absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-white bg-emerald-500 dark:border-[#0e1520]'
              aria-hidden
            />
          </span>
        </span>

        <div className='flex min-w-0 flex-col'>
          <span className='font-mono text-[10px] font-semibold tracking-[0.2em] text-sky-600 uppercase dark:text-sky-400'>
            QQ Group
          </span>
          <span className='text-foreground truncate text-base font-semibold lg:text-lg'>
            {t('Join the YMeng CC QQ group')}
          </span>
          <span className='text-muted-foreground mt-0.5 text-xs'>
            {t('Q&A, feedback and new model updates')}
          </span>
        </div>
      </div>

      <div className='mt-3 flex flex-wrap items-center gap-2'>
        <Button
          size='sm'
          className='home-qq-shine group relative h-8 overflow-hidden rounded-lg bg-[#12b7f5] px-3.5 text-xs font-medium text-white hover:bg-[#0aa3dc]'
          render={
            <a
              href={COMMUNITY_QQ_GROUP_URL}
              target='_blank'
              rel='noopener noreferrer'
            />
          }
        >
          {t('Join group')}
          <ArrowUpRight className='ml-0.5 size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5' />
        </Button>
        <span className='hidden items-center gap-1.5 xl:flex'>
          {topics.map((topic) => (
            <span
              key={topic}
              className='rounded-full border border-sky-500/15 bg-sky-500/5 px-2 py-0.5 text-[11px] text-sky-700 dark:border-sky-400/15 dark:bg-sky-400/5 dark:text-sky-300'
            >
              #{topic}
            </span>
          ))}
        </span>
      </div>
    </div>
  )
}
