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
import { CherryStudio } from '@lobehub/icons'
import { Link } from '@tanstack/react-router'
import { ArrowRight, BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useStatus } from '@/hooks/use-status'
import { isHttpUrl } from '@/lib/content-format'

import { BAOCODE_ICON_URL, DEFAULT_BAOCODE_URL } from '../../constants'
import { HeroTerminalDemo } from '../hero-terminal-demo'

interface ConsolePanelProps {
  isAuthenticated?: boolean
}

const APP_PILL_CLASSES =
  'group border-border/40 bg-background/60 text-foreground/80 hover:border-border hover:bg-muted/40 hover:text-foreground flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm font-medium backdrop-blur-xs transition-all duration-300 hover:-translate-y-0.5'

const OUTLINE_BUTTON_CLASSES =
  'group border-border/60 bg-background/60 hover:border-border hover:bg-muted/50 inline-flex h-11 items-center gap-1.5 rounded-lg px-5 text-sm font-medium backdrop-blur-xs'

export function ConsolePanel(props: ConsolePanelProps) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const configuredLink = status?.baocode_link
  const baocodeLink =
    typeof configuredLink === 'string' && isHttpUrl(configuredLink.trim())
      ? configuredLink.trim()
      : DEFAULT_BAOCODE_URL
  const docsUrl =
    (status?.docs_link as string | undefined) || 'https://docs.newapi.pro'

  const docsIcon = (
    <BookOpen className='text-muted-foreground/80 group-hover:text-foreground size-4 transition-colors duration-200' />
  )
  const docsButton = docsUrl.startsWith('http') ? (
    <Button
      variant='outline'
      className={OUTLINE_BUTTON_CLASSES}
      render={<a href={docsUrl} target='_blank' rel='noopener noreferrer' />}
    >
      {docsIcon}
      <span>{t('Docs')}</span>
    </Button>
  ) : (
    <Button
      variant='outline'
      className={OUTLINE_BUTTON_CLASSES}
      render={<Link to={docsUrl} />}
    >
      {docsIcon}
      <span>{t('Docs')}</span>
    </Button>
  )

  return (
    <div className='flex w-full min-w-0 flex-col items-start text-left'>
      <div
        className='landing-animate-fade-up mb-6 flex flex-wrap items-center gap-3 opacity-0'
        style={{ animationDelay: '120ms' }}
      >
        <span className='text-muted-foreground/70 font-mono text-[11px] tracking-[0.2em] uppercase'>
          {t('For developers')}
        </span>
        <span className='bg-border h-px w-8' aria-hidden />
        <span className='inline-flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-500/5 px-3 py-1 text-[11px] font-medium text-blue-600 dark:border-blue-400/20 dark:bg-blue-400/5 dark:text-blue-400'>
          <span className='relative flex size-1.5'>
            <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75' />
            <span className='relative inline-flex size-1.5 rounded-full bg-blue-500 dark:bg-blue-400' />
          </span>
          {t('AI Application Infrastructure Foundation')}
        </span>
      </div>

      <h2
        className='landing-animate-fade-up text-[clamp(2rem,3.6vw,3rem)] leading-[1.12] font-bold tracking-tight opacity-0'
        style={{ animationDelay: '180ms' }}
      >
        {t('Unified API Gateway for')}
        <br />
        <span className='bg-gradient-to-r from-blue-400 via-violet-400 to-purple-500 bg-clip-text text-transparent'>
          {t('Vast Range of AI Models')}
        </span>
      </h2>
      <p
        className='landing-animate-fade-up text-muted-foreground/80 mt-5 max-w-xl text-base leading-relaxed opacity-0 md:text-[15px]'
        style={{ animationDelay: '240ms' }}
      >
        {t(
          'Access a vast selection of models via a standard, unified API protocol. Power AI applications, manage digital assets, and connect the Future.'
        )}
      </p>

      <div
        className='landing-animate-fade-up mt-8 flex flex-wrap items-center gap-3 opacity-0'
        style={{ animationDelay: '300ms' }}
      >
        {props.isAuthenticated ? (
          <Button
            className='group shadow-primary/25 h-12 rounded-lg px-7 text-base font-semibold shadow-md'
            render={<Link to='/dashboard' />}
          >
            {t('Sign in')}
            <ArrowRight className='ml-1.5 size-4 transition-transform duration-200 group-hover:translate-x-0.5' />
          </Button>
        ) : (
          <>
            <Button
              className='group h-11 rounded-lg px-5 text-sm font-medium'
              render={<Link to='/sign-up' />}
            >
              {t('Get Started')}
              <ArrowRight className='ml-1.5 size-4 transition-transform duration-200 group-hover:translate-x-0.5' />
            </Button>
            <Button
              variant='outline'
              className={OUTLINE_BUTTON_CLASSES}
              render={<Link to='/pricing' />}
            >
              {t('View Pricing')}
            </Button>
          </>
        )}
        {docsButton}
      </div>

      <div
        className='landing-animate-fade-up mt-9 w-full max-w-xl opacity-0'
        style={{ animationDelay: '360ms' }}
      >
        <div className='mb-3 flex items-baseline gap-3'>
          <span className='text-muted-foreground/60 text-[10px] font-bold tracking-[0.15em] uppercase'>
            {t('Supported Applications')}
          </span>
          <span className='bg-border/70 h-px flex-1' aria-hidden />
        </div>
        <div className='flex flex-wrap items-center gap-2.5'>
          <a
            href={baocodeLink}
            target='_blank'
            rel='noopener noreferrer'
            className={APP_PILL_CLASSES}
          >
            <img
              src={BAOCODE_ICON_URL}
              alt=''
              className='size-5 shrink-0 rounded-[5px]'
            />
            <span>BaoCode</span>
          </a>
          <a
            href='https://cherry-ai.com'
            target='_blank'
            rel='noopener noreferrer'
            className={APP_PILL_CLASSES}
          >
            <CherryStudio.Color size={20} className='shrink-0' />
            <span>Cherry Studio</span>
          </a>
          <a
            href='https://ccswitch.io'
            target='_blank'
            rel='noopener noreferrer'
            className={APP_PILL_CLASSES}
          >
            <img
              src='/ccswitch-favicon.png'
              alt=''
              className='size-5 shrink-0 rounded-md object-contain'
              onError={(event) => {
                // Fall back to a text avatar if the local asset is unavailable
                event.currentTarget.style.display = 'none'
                const fallback = event.currentTarget.nextElementSibling
                if (fallback instanceof HTMLElement) {
                  fallback.style.display = 'flex'
                }
              }}
            />
            <span
              style={{ display: 'none' }}
              className='size-5 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-[9px] font-bold text-blue-600 dark:bg-blue-400/10 dark:text-blue-400'
            >
              CC
            </span>
            <span>CC Switch</span>
          </a>
          <span className='text-muted-foreground/60 px-2 text-sm'>
            {t('More Apps')}
          </span>
        </div>
      </div>

      <div
        className='landing-animate-fade-up mt-10 w-full opacity-0'
        style={{ animationDelay: '420ms' }}
      >
        <HeroTerminalDemo className='max-w-xl lg:mx-0 xl:rotate-[-1.2deg]' />
      </div>
    </div>
  )
}
