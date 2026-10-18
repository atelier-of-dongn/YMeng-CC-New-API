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
import { Link } from '@tanstack/react-router'
import { ChevronDown, Menu } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { splitHeaderNavLinks } from '@/lib/nav-modules'
import { cn } from '@/lib/utils'

import type { TopNavLink } from '../types'

type TopNavProps = React.HTMLAttributes<HTMLElement> & {
  links: TopNavLink[]
}

function TopNavMenuItem(props: { link: TopNavLink }) {
  const className = props.link.isActive ? '' : 'text-muted-foreground'
  return (
    <DropdownMenuItem
      disabled={props.link.disabled}
      render={
        props.link.external ? (
          <a
            href={props.link.href}
            target='_blank'
            rel='noopener noreferrer'
            className={className}
          >
            {props.link.title}
          </a>
        ) : (
          <Link
            to={props.link.href}
            className={className}
            disabled={props.link.disabled}
          >
            {props.link.title}
          </Link>
        )
      }
    />
  )
}

export function TopNav({ className, links, ...props }: TopNavProps) {
  const { t } = useTranslation()
  const normalizedLinks = useMemo(
    () =>
      links.map((link) => ({
        isActive: false,
        disabled: false,
        external: false,
        ...link,
      })),
    [links]
  )
  const desktopLinks = splitHeaderNavLinks(normalizedLinks)

  return (
    <>
      <div className='lg:hidden'>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={<Button size='icon' variant='outline' className='size-7' />}
          >
            <Menu aria-hidden='true' />
            <span className='sr-only'>{t('Open navigation menu')}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent side='bottom' align='start'>
            {normalizedLinks.map((link) => (
              <TopNavMenuItem key={`${link.title}-${link.href}`} link={link} />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav
        className={cn(
          'hidden items-center space-x-4 lg:flex lg:space-x-4 xl:space-x-6',
          className
        )}
        {...props}
      >
        {desktopLinks.visible.map((link) =>
          link.external ? (
            <a
              key={`${link.title}-${link.href}`}
              href={link.href}
              target='_blank'
              rel='noopener noreferrer'
              className={cn(
                'hover:text-primary text-sm font-medium transition-colors',
                !link.isActive && 'text-muted-foreground',
                link.disabled && 'pointer-events-none opacity-50'
              )}
            >
              {link.title}
            </a>
          ) : (
            <Link
              key={`${link.title}-${link.href}`}
              to={link.href}
              disabled={link.disabled}
              className={cn(
                'hover:text-primary text-sm font-medium transition-colors',
                !link.isActive && 'text-muted-foreground'
              )}
            >
              {link.title}
            </Link>
          )
        )}

        {desktopLinks.overflow.length > 0 ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger className='text-muted-foreground hover:text-primary flex items-center gap-1 text-sm font-medium transition-colors'>
              {t('More')}
              <ChevronDown className='size-3.5' aria-hidden='true' />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              {desktopLinks.overflow.map((link) => (
                <TopNavMenuItem
                  key={`${link.title}-${link.href}`}
                  link={link}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </nav>
    </>
  )
}
