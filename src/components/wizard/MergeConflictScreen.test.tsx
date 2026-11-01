import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MergeConflictScreen } from '@/components/wizard/MergeConflictScreen'
import { useWizardStore } from '@/lib/store'
import { makeConflictAccount, makeMergedAccount, makePasswordEntry } from '@/test/factories'

vi.mock('@/lib/tauri', () => ({
  parseCsvs: vi.fn(),
  mergeEntries: vi.fn(),
  pickCsvFile: vi.fn(),
  pickCsvFiles: vi.fn(),
  openDebugCsvWindow: vi.fn(),
}))

const get = () => useWizardStore.getState()

beforeEach(() => {
  useWizardStore.getState().reset()
})

/** One conflict with two candidates: pw-chrome @ example.com, pw-safari @ app.example.com. */
function seedOneConflict() {
  useWizardStore.setState({
    step: 'merge-conflict',
    rawMergedAccounts: [makeConflictAccount()],
  })
}

describe('MergeConflictScreen', () => {
  it('renders nothing when there are no conflicts', () => {
    useWizardStore.setState({ rawMergedAccounts: [makeMergedAccount()] })
    const { container } = render(<MergeConflictScreen />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the account and its position in the conflict run', () => {
    useWizardStore.setState({
      step: 'merge-conflict',
      rawMergedAccounts: [makeConflictAccount(), makeConflictAccount()],
    })
    render(<MergeConflictScreen />)
    expect(screen.getByText('Conflict 1 of 2')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'example.com' })).toBeInTheDocument()
  })

  it('masks every password until the user asks to see them', async () => {
    const user = userEvent.setup()
    seedOneConflict()
    const { container } = render(<MergeConflictScreen />)

    expect(container.textContent).not.toContain('pw-chrome')
    expect(container.textContent).not.toContain('pw-safari')
    expect(container.textContent).toContain('•')

    await user.click(screen.getByRole('button', { name: /Show passwords/ }))
    expect(container.textContent).toContain('pw-chrome')
    expect(container.textContent).toContain('pw-safari')

    await user.click(screen.getByRole('button', { name: /Hide passwords/ }))
    expect(container.textContent).not.toContain('pw-chrome')
  })

  it('shows each candidate with its source and the subdomain it came from', () => {
    seedOneConflict()
    render(<MergeConflictScreen />)
    expect(screen.getByText('From Chrome')).toBeInTheDocument()
    expect(screen.getByText('From Safari')).toBeInTheDocument()
    expect(screen.getByText('app.example.com')).toBeInTheDocument()
  })

  it('falls back to the raw url when a candidate url will not parse', () => {
    useWizardStore.setState({
      step: 'merge-conflict',
      rawMergedAccounts: [
        makeConflictAccount({
          passwords: [
            makePasswordEntry({ password: 'a', source: 'Chrome', url: 'not a url' }),
            makePasswordEntry({ password: 'b', source: 'Safari', url: null }),
          ],
        }),
      ],
    })
    render(<MergeConflictScreen />)
    expect(screen.getByText('not a url')).toBeInTheDocument()
    // A null url falls back to the account domain.
    expect(screen.getByText('example.com', { selector: 'span' })).toBeInTheDocument()
  })

  it('defaults to combining on the first candidate', async () => {
    const user = userEvent.setup()
    seedOneConflict()
    render(<MergeConflictScreen />)
    await user.click(screen.getByRole('button', { name: 'Combine' }))
    expect(get().mergedAccounts[0].passwords.map(p => p.password)).toEqual(['pw-chrome'])
  })

  it('combines on the candidate the user picks', async () => {
    const user = userEvent.setup()
    seedOneConflict()
    render(<MergeConflictScreen />)
    await user.click(screen.getByText('From Safari'))
    await user.click(screen.getByRole('button', { name: 'Combine' }))
    expect(get().mergedAccounts[0].passwords.map(p => p.password)).toEqual(['pw-safari'])
  })

  it('selects a candidate from the keyboard', async () => {
    const user = userEvent.setup()
    seedOneConflict()
    render(<MergeConflictScreen />)
    const cards = screen.getAllByRole('button').filter(el => el.dataset.selected !== undefined)
    cards[1].focus()
    await user.keyboard(' ')
    expect(cards[1].dataset.selected).toBe('true')
  })

  it('keeps candidates separate when the user chooses option 2', async () => {
    const user = userEvent.setup()
    seedOneConflict()
    render(<MergeConflictScreen />)
    fireEvent.keyDown(window, { key: '2' })
    await user.click(screen.getByRole('button', { name: 'Keep separate' }))
    expect(get().mergedAccounts).toHaveLength(2)
    expect(get().mergedAccounts.map(a => a.sources)).toEqual([['Chrome'], ['Safari']])
  })

  it('discards every candidate when the user chooses option 3', async () => {
    const user = userEvent.setup()
    seedOneConflict()
    render(<MergeConflictScreen />)
    fireEvent.keyDown(window, { key: '3' })
    await user.click(screen.getByRole('button', { name: 'Discard all' }))
    expect(get().mergedAccounts).toEqual([])
    expect(get().discardedAccounts).toHaveLength(1)
  })

  it('returns to combine on key 1', () => {
    seedOneConflict()
    render(<MergeConflictScreen />)
    fireEvent.keyDown(window, { key: '2' })
    expect(screen.getByRole('button', { name: 'Keep separate' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '1' })
    expect(screen.getByRole('button', { name: 'Combine' })).toBeInTheDocument()
  })

  it('commits on Enter', () => {
    seedOneConflict()
    render(<MergeConflictScreen />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(get().mergedAccounts).toHaveLength(1)
  })

  it('resets the action and chosen candidate when the next conflict appears', async () => {
    const user = userEvent.setup()
    useWizardStore.setState({
      step: 'merge-conflict',
      rawMergedAccounts: [
        makeConflictAccount({ normalizedDomain: 'first.com' }),
        makeConflictAccount({ normalizedDomain: 'second.com' }),
      ],
    })
    render(<MergeConflictScreen />)

    fireEvent.keyDown(window, { key: '3' })
    await user.click(screen.getByRole('button', { name: 'Discard all' }))

    // Second conflict is now visible, with the action back at its default.
    expect(screen.getByText('second.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Combine' })).toBeInTheDocument()
  })

  it('goes back through the wizard history', async () => {
    const user = userEvent.setup()
    seedOneConflict()
    useWizardStore.setState({ history: ['import-summary'] })
    render(<MergeConflictScreen />)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(get().step).toBe('import-summary')
  })
})
