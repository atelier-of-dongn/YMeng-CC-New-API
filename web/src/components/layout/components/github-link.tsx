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

import { IconGithub } from '@/assets/brand-icons'
import { Button } from '@/components/ui/button'
import { GITHUB_REPO_URL } from '@/lib/constants'
import { cn } from '@/lib/utils'

type GitHubLinkProps = {
  className?: string
}

/**
 * Opens the project's GitHub repository in a new tab.
 * Rendered next to the brand in the public and console top bars.
 */
export function GitHubLink(props: GitHubLinkProps) {
  const { t } = useTranslation()

  return (
    <Button
      variant='ghost'
      size='icon'
      className={cn(
        'text-muted-foreground hover:text-foreground size-9',
        props.className
      )}
      aria-label={t('GitHub')}
      render={
        <a href={GITHUB_REPO_URL} target='_blank' rel='noopener noreferrer' />
      }
    >
      <IconGithub className='size-[1.2rem]' aria-hidden='true' />
    </Button>
  )
}
