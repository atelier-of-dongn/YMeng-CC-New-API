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
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTopNavLinks } from '@/hooks/use-top-nav-links'
import { splitHeaderNavLinks } from '@/lib/nav-modules'
import { cn } from '@/lib/utils'

import { defaultTopNavLinks } from '../config/top-nav.config'
import type { TopNavLink } from '../types'

interface PublicNavigationProps {
  links?: TopNavLink[]
  className?: string
}

function PublicNavigationMenuItem(props: { link: TopNavLink }) {
  return (
    <DropdownMenuItem
      disabled={props.link.disabled}
      render={
        props.link.external ? (
          <a href={props.link.href} target='_blank' rel='noopener noreferrer'>
            {props.link.title}
          </a>
        ) : (
          <Link to={props.link.href}>{props.link.title}</Link>
        )
      }
    />
  )
}

export function PublicNavigation(props: PublicNavigationProps = {}) {
  const { t } = useTranslation()
  const dynamicLinks = useTopNavLinks()
  const defaultLinks = props.links || defaultTopNavLinks
  const links = dynamicLinks.length > 0 ? dynamicLinks : defaultLinks
  const desktopLinks = splitHeaderNavLinks(links)

  return (
    <nav className={cn('hidden items-center gap-1 md:flex', props.className)}>
      {desktopLinks.visible.map((link) => {
        const linkClassName = cn(
          'text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground inline-flex h-9 w-max items-center justify-center rounded-md bg-transparent px-4 py-2 text-sm font-medium transition-colors focus:outline-none',
          link.disabled && 'pointer-events-none opacity-50'
        )
        if (link.external) {
          return (
            <a
              key={`${link.title}-${link.href}`}
              href={link.href}
              target='_blank'
              rel='noopener noreferrer'
              className={linkClassName}
            >
              {link.title}
            </a>
          )
        }
        return (
          <Link
            key={`${link.title}-${link.href}`}
            to={link.href}
            className={linkClassName}
          >
            {link.title}
          </Link>
        )
      })}

      {desktopLinks.overflow.length > 0 ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger className='text-muted-foreground hover:bg-accent hover:text-accent-foreground flex h-9 items-center gap-1 rounded-md px-4 py-2 text-sm font-medium transition-colors'>
            {t('More')}
            <ChevronDown className='size-3.5' aria-hidden='true' />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            {desktopLinks.overflow.map((link) => (
              <PublicNavigationMenuItem
                key={`${link.title}-${link.href}`}
                link={link}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </nav>
  )
}
