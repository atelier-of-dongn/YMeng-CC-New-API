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
import { ArrowUpRight, Download, LogIn, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useSystemConfig } from '@/hooks/use-system-config'

import { BAOCODE_ICON_URL, BAOCODE_YMENGCC_URL } from '../../constants'
import { BaoCodeAdvantages } from './baocode-advantages'

// The beginner entry: BaoCode's channel page for YMeng CC, drawn in
// BaoCode's own paper look (colors and fonts from .home-paper).
export function BaoCodePanel() {
  const { t } = useTranslation()
  const { logo } = useSystemConfig()

  const steps = [
    { icon: Download, text: t('Download BaoCode for Mac, Windows or Linux') },
    { icon: LogIn, text: t('Sign in with your YMeng CC account directly') },
    {
      icon: Sparkles,
      text: t('Pick a model and start coding, no API setup needed'),
    },
  ]

  return (
    <div className='home-paper flex w-full min-w-0 flex-col items-start text-left text-[var(--paper-body)]'>
      <div
        className='landing-animate-fade-up mb-6 w-full opacity-0'
        style={{ animationDelay: '0ms' }}
      >
        <BaoCodeAdvantages />
      </div>

      <div
        className='landing-animate-fade-up mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--paper-pill-border)] bg-[var(--paper-pill-bg)] px-3 py-1 text-xs font-semibold tracking-wide text-[var(--paper-pill-ink)] opacity-0'
        style={{ animationDelay: '40ms' }}
      >
        <span>{t('Beginner friendly')}</span>
        <span aria-hidden>·</span>
        <span>{t('Partner channel')}</span>
      </div>

      <h1
        className='landing-animate-fade-up font-[family-name:var(--paper-serif)] text-[clamp(2rem,3.4vw,2.75rem)] leading-[1.15] font-semibold tracking-[-0.015em] text-[var(--paper-ink)] opacity-0'
        style={{ animationDelay: '60ms' }}
      >
        <span className='inline-flex items-center gap-[0.28em] whitespace-nowrap'>
          <img
            src={logo}
            alt=''
            className='h-[0.78em] w-auto rounded-[0.18em]'
            onError={(event) => {
              // A missing site logo leaves the name on its own
              event.currentTarget.style.display = 'none'
            }}
          />
          YMeng CC
          <span className='mx-[0.12em] font-normal text-[var(--paper-faint)]'>
            ×
          </span>
        </span>{' '}
        <span className='inline-flex items-center gap-[0.28em] whitespace-nowrap'>
          <img
            src={BAOCODE_ICON_URL}
            alt=''
            className='h-[0.78em] w-auto rounded-[0.18em]'
          />
          BaoCode
        </span>
      </h1>

      <p
        className='landing-animate-fade-up mt-3 font-[family-name:var(--paper-serif)] text-xl leading-snug text-[var(--paper-muted)] opacity-0 md:text-[22px]'
        style={{ animationDelay: '120ms' }}
      >
        {t('One gateway, multiple models. Turn ideas into code.')}
      </p>

      <p
        className='landing-animate-fade-up mt-5 max-w-md font-[family-name:var(--paper-serif)] text-[17px] leading-[1.7] opacity-0'
        style={{ animationDelay: '180ms' }}
      >
        {t(
          'Less setup, more creation. Access multiple AI models through YMeng CC, choose your coding companion in BaoCode, and bring your next idea to life.'
        )}
      </p>

      <ol
        className='landing-animate-fade-up mt-6 flex flex-col gap-3 opacity-0'
        style={{ animationDelay: '240ms' }}
      >
        {steps.map((step, index) => (
          <li key={step.text} className='flex items-center gap-3 text-[15px]'>
            <span className='w-4 text-right text-sm text-[var(--paper-faint)] tabular-nums'>
              {index + 1}
            </span>
            <step.icon
              className='size-4 shrink-0 text-[var(--paper-muted)]'
              aria-hidden
            />
            <span>{step.text}</span>
          </li>
        ))}
      </ol>

      <div
        className='landing-animate-fade-up mt-8 flex flex-wrap items-center gap-3 opacity-0'
        style={{ animationDelay: '300ms' }}
      >
        <Button
          className='group h-10 rounded-md border border-[var(--paper-ink)] bg-[var(--paper-ink)] px-4 text-[15px] font-medium text-[var(--paper)] hover:bg-[var(--paper-ink-hover)]'
          render={
            <a
              href={BAOCODE_YMENGCC_URL}
              target='_blank'
              rel='noopener noreferrer'
            />
          }
        >
          {t('Get BaoCode')}
          <ArrowUpRight className='ml-1 size-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5' />
        </Button>
        <span className='text-[13.5px] text-[var(--paper-muted)]'>
          {t('Free and open source')}
        </span>
      </div>

      <p
        className='landing-animate-fade-up mt-6 text-[13.5px] text-[var(--paper-muted)] opacity-0'
        style={{ animationDelay: '360ms' }}
      >
        {['macOS', 'Windows', 'Linux', t('No API key needed')].map(
          (item, index) => (
            <span key={item} className='inline-block'>
              {index > 0 && (
                <span className='mx-2 text-[var(--paper-faint)]' aria-hidden>
                  ·
                </span>
              )}
              {item}
            </span>
          )
        )}
      </p>
    </div>
  )
}
