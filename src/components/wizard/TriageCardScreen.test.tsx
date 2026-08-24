import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TriageCardScreen } from '@/components/wizard/TriageCardScreen'
import { useWizardStore } from '@/lib/store'
import { SENTINEL_PASSWORD, makeMergedAccount, makePasswordEntry } from '@/test/factories'

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

function seed(count = 3) {
  useWizardStore.setState({
    step: 'triage-card',
    mergedAccounts: Array.from({ length: count }, (_, i) =>
      makeMergedAccount({ normalizedDomain: `site-${i}.com`, username: `user-${i}@x.com` }),
    ),
  })
}

describe('TriageCardScreen', () => {
  it('renders nothing when the triage index is past the end', () => {
    useWizardStore.setState({ mergedAccounts: [], triageIndex: 0 })
    const { container } = render(<TriageCardScreen />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the current account and its position in the run', () => {
    seed(3)
    render(<TriageCardScreen />)
    expect(screen.getByText('site-0.com')).toBeInTheDocument()
    expect(screen.getByText('user-0@x.com')).toBeInTheDocument()
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
  })

  it('falls back to placeholder text for an account with no username', () => {
    useWizardStore.setState({
      step: 'triage-card',
      mergedAccounts: [makeMergedAccount({ username: '' })],
    })
    render(<TriageCardScreen />)
    expect(screen.getByText('(no username)')).toBeInTheDocument()
  })

  it('never renders the password', () => {
    useWizardStore.setState({
      step: 'triage-card',
      mergedAccounts: [
        makeMergedAccount({ passwords: [makePasswordEntry({ password: SENTINEL_PASSWORD })] }),
      ],
    })
    const { container } = render(<TriageCardScreen />)
    expect(container.textContent).not.toContain(SENTINEL_PASSWORD)
    expect(screen.getByText('Password hidden')).toBeInTheDocument()
  })

  it('lists the contributing sources', () => {
    useWizardStore.setState({
      step: 'triage-card',
      mergedAccounts: [makeMergedAccount({ sources: ['Chrome', 'Safari'] })],
    })
    render(<TriageCardScreen />)
    expect(screen.getByText('Sources: Chrome, Safari')).toBeInTheDocument()
  })

  it('tallies a decision from each button and moves to the next account', async () => {
    const user = userEvent.setup()
    seed(3)
    render(<TriageCardScreen />)

    await user.click(screen.getByRole('button', { name: 'Keep (K)' }))
    expect(get().triageDecisions).toEqual({ keep: 1, delete: 0, skip: 0 })
    expect(screen.getByText('2 of 3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete (D)' }))
    expect(get().triageDecisions).toEqual({ keep: 1, delete: 1, skip: 0 })

    await user.click(screen.getByRole('button', { name: 'Skip (S)' }))
    expect(get().triageDecisions).toEqual({ keep: 1, delete: 1, skip: 1 })
    expect(get().step).toBe('triage-complete')
  })

  it.each([
    ['k', 'keep'],
    ['K', 'keep'],
    ['d', 'delete'],
    ['D', 'delete'],
    ['s', 'skip'],
    ['S', 'skip'],
  ])('handles the %s keyboard shortcut as %s', (key, decision) => {
    seed(3)
    render(<TriageCardScreen />)
    fireEvent.keyDown(window, { key })
    expect(get().triageDecisions[decision as 'keep' | 'delete' | 'skip']).toBe(1)
    expect(get().triageIndex).toBe(1)
  })

  it('ignores unrelated keys', () => {
    seed(3)
    render(<TriageCardScreen />)
    fireEvent.keyDown(window, { key: 'x' })
    expect(get().triageIndex).toBe(0)
    expect(get().triageDecisions).toEqual({ keep: 0, delete: 0, skip: 0 })
  })

  it('unbinds the window listener on unmount', () => {
    seed(3)
    const { unmount } = render(<TriageCardScreen />)
    unmount()
    fireEvent.keyDown(window, { key: 'k' })
    expect(get().triageIndex).toBe(0)
  })

  it('goes back through the wizard history', async () => {
    const user = userEvent.setup()
    seed(1)
    useWizardStore.setState({ history: ['import-summary'] })
    render(<TriageCardScreen />)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(get().step).toBe('import-summary')
  })
})
