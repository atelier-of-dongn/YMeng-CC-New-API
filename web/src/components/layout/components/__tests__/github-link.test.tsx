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
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { GitHubLink } from '@/components/layout/components/github-link'
import { GITHUB_REPO_URL } from '@/lib/constants'

describe('GitHubLink', () => {
  it('renders a GitHub repository link in a new tab', () => {
    render(<GitHubLink />)

    // `Button` with a link `render` adopts role="button" (button semantics
    // take precedence over the link role in the accessibility tree).
    const link = screen.getByRole('button', { name: 'GitHub' })

    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', GITHUB_REPO_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })
})
