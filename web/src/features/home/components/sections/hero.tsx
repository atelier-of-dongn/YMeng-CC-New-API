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
import { RiQqLine } from 'react-icons/ri'

import { BaoCodePanel } from './baocode-panel'
import { CommunityCard } from './community-card'
import { CommunityChatPreview } from './community-chat-preview'
import { ConsolePanel } from './console-panel'

interface HeroProps {
  className?: string
  isAuthenticated?: boolean
}

// The first screen, split by a slanted seam (see .home-split in index.css):
// BaoCode's beginner entry on the paper side, the developer console entry on
// the other. Stacked below lg with the developer entry first (its column comes
// first in the DOM), and the paper side below it ending in a slanted edge.
export function Hero(props: HeroProps) {
  return (
    <section className='home-split relative isolate overflow-hidden'>
      {/* Console side: radial glow and grid */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 -z-20 opacity-25 dark:opacity-[0.12]'
        style={{
          background: [
            'radial-gradient(ellipse 45% 50% at 78% 25%, oklch(0.72 0.18 250 / 80%) 0%, transparent 70%)',
            'radial-gradient(ellipse 35% 40% at 95% 10%, oklch(0.65 0.15 200 / 60%) 0%, transparent 70%)',
            'radial-gradient(ellipse 35% 35% at 70% 85%, oklch(0.70 0.12 280 / 40%) 0%, transparent 70%)',
          ].join(', '),
        }}
      />
      <div
        aria-hidden
        className='absolute inset-0 -z-20 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_45%_55%_at_75%_35%,black_20%,transparent_100%)] bg-[size:4rem_4rem] opacity-[0.1]'
      />

      {/* Community corner, cut off by a second seam; the paper side covers
          its left end, so it shows from the main seam rightwards */}
      <div
        aria-hidden
        className='home-community-wedge absolute inset-x-0 top-0 -z-[15] hidden lg:block'
      />
      <div
        aria-hidden
        className='home-community-seam absolute inset-x-0 top-0 -z-[15] hidden lg:block'
      />

      {/* Paper side, seam and badge from lg up */}
      <div
        aria-hidden
        className='home-paper home-paper-clip-lg absolute inset-0 -z-10 hidden bg-[var(--paper)] lg:block'
      >
        <div className='home-paper-grid' />
      </div>
      <div
        aria-hidden
        className='home-seam-lg absolute inset-0 -z-10 hidden lg:block'
      />
      <div
        aria-hidden
        className='home-paper home-seam-badge absolute top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 lg:flex'
      >
        ×
      </div>

      <div className='mx-auto grid max-w-7xl grid-cols-1 lg:min-h-[100svh] lg:grid-cols-[minmax(0,42fr)_minmax(0,58fr)] lg:px-8'>
        <div className='relative flex flex-col items-start px-6 pt-24 pb-20 md:px-10 lg:col-start-2 lg:row-start-1 lg:px-0 lg:pt-24 lg:pb-24 lg:pl-16 xl:pl-20'>
          <div className='home-community-content mb-12 flex w-full min-w-0 flex-col items-start gap-5 empty:hidden'>
            <CommunityCard />
            <CommunityChatPreview className='hidden w-full max-w-sm 2xl:block' />
          </div>
          {/* The narrow end of the community slice: a faint penguin and a
              looping chat peek that stays above the seam */}
          <RiQqLine
            aria-hidden
            className='pointer-events-none absolute top-2 right-[20.5rem] hidden size-36 -rotate-12 text-sky-500/[0.07] xl:block dark:text-sky-300/[0.06]'
          />
          <ConsolePanel isAuthenticated={props.isAuthenticated} />
        </div>

        <div className='relative flex items-center px-6 pt-20 pb-24 md:px-10 lg:col-start-1 lg:row-start-1 lg:items-start lg:px-0 lg:pt-24 lg:pr-20 lg:pb-24'>
          {/* Paper side below lg: its own background with a slanted bottom */}
          <div
            aria-hidden
            className='home-paper home-paper-clip-sm absolute inset-0 -z-10 bg-[var(--paper)] lg:hidden'
          >
            <div className='home-paper-grid' />
          </div>
          <div
            aria-hidden
            className='home-seam-sm absolute inset-0 -z-10 lg:hidden'
          />
          <div
            aria-hidden
            className='home-paper home-seam-badge absolute bottom-7 left-1/2 z-10 flex -translate-x-1/2 translate-y-1/2 lg:hidden'
          >
            ×
          </div>
          <BaoCodePanel />
        </div>
      </div>
    </section>
  )
}
