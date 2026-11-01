import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewMergesScreen } from '@/components/wizard/ReviewMergesScreen'
import { useWizardStore } from '@/lib/store'
import { SENTINEL_PASSWORD, makeMergedAccount, makeReviewAccount, makeSubdomainMerge } from '@/test/factories'

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

afterEach(() => {
  vi.useRealTimers()
})

describe('ReviewMergesScreen', () => {
  it('builds its rows from the merged accounts on mount', () => {
    useWizardStore.setState({
      mergedAccounts: [makeSubdomainMerge({ normalizedDomain: 'built.com' })],
    })
    render(<ReviewMergesScreen />)
    expect(get().reviewAccounts.map(r => r.domain)).toEqual(['built.com'])
    expect(screen.getByText('built.com')).toBeInTheDocument()
  })

  it('renders a harmless fallback when there is nothing to review at all', () => {
    useWizardStore.setState({ mergedAccounts: [makeMergedAccount()] })
    render(<ReviewMergesScreen />)
    expect(screen.getByText(/Everything looked clearly separate/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
  })

  it('auto-advances after 1.5s when every merge is boring', () => {
    vi.useFakeTimers()
    useWizardStore.setState({
      step: 'review-merges',
      mergedAccounts: [makeSubdomainMerge({ subdomainIsInteresting: false })],
    })
    render(<ReviewMergesScreen />)

    expect(screen.getByText('Moving on…')).toBeInTheDocument()
    expect(get().step).toBe('review-merges')

    vi.advanceTimersByTime(1500)
    expect(get().step).toBe('triage-card')
  })

  it('does not auto-advance while an interesting merge is present', () => {
    vi.useFakeTimers()
    useWizardStore.setState({
      step: 'review-merges',
      mergedAccounts: [makeSubdomainMerge({ subdomainIsInteresting: true })],
    })
    render(<ReviewMergesScreen />)
    vi.advanceTimersByTime(5000)
    expect(get().step).toBe('review-merges')
  })

  it('hides boring merges until the show-all filter is ticked', async () => {
    const user = userEvent.setup()
    useWizardStore.setState({
      reviewAccounts: [
        makeReviewAccount({ id: 'interesting', domain: 'shown.com', fromInterestingMerge: true }),
        makeReviewAccount({ id: 'boring', domain: 'hidden.com', fromInterestingMerge: false }),
      ],
    })
    render(<ReviewMergesScreen />)

    expect(screen.getByText('shown.com')).toBeInTheDocument()
    expect(screen.queryByText('hidden.com')).not.toBeInTheDocument()
    expect(screen.getByText('Show all merges (1 hidden)')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /Show all merges/ }))
    expect(screen.getByText('hidden.com')).toBeInTheDocument()
  })

  it('shows a chip for every subdomain, plus the combined count', () => {
    useWizardStore.setState({
      reviewAccounts: [
        makeReviewAccount({
          urls: [
            'https://one.example.com',
            'https://two.example.com',
            'https://three.example.com',
            'https://four.example.com',
          ],
        }),
      ],
    })
    render(<ReviewMergesScreen />)
    expect(screen.getByText('one')).toBeInTheDocument()
    expect(screen.getByText('three')).toBeInTheDocument()
    expect(screen.getByText('four')).toBeInTheDocument()
    expect(screen.getByText('4 combined')).toBeInTheDocument()
  })

  it('masks passwords in the expanded url list until revealed', async () => {
    const user = userEvent.setup()
    useWizardStore.setState({ reviewAccounts: [makeReviewAccount({ id: 'r1' })] })
    const { container } = render(<ReviewMergesScreen />)

    await user.click(screen.getByText('user@example.com'))
    expect(container.textContent).not.toContain(SENTINEL_PASSWORD)

    await user.click(screen.getByRole('button', { name: /Show passwords/ }))
    expect(container.textContent).toContain(SENTINEL_PASSWORD)
  })

  it('splits a row apart from the expanded panel', async () => {
    const user = userEvent.setup()
    useWizardStore.setState({ reviewAccounts: [makeReviewAccount({ id: 'r1' })] })
    render(<ReviewMergesScreen />)

    await user.click(screen.getByText('user@example.com'))
    await user.click(screen.getByRole('button', { name: 'Split all apart' }))

    expect(get().reviewAccounts).toHaveLength(2)
    expect(get().reviewAccounts.every(r => r.urls.length === 1)).toBe(true)
    expect(screen.getAllByText('split off')).toHaveLength(2)
  })

  it('peels only the checked urls off', async () => {
    const user = userEvent.setup()
    useWizardStore.setState({
      reviewAccounts: [
        makeReviewAccount({
          id: 'r1',
          urls: ['https://a.example.com', 'https://b.example.com', 'https://c.example.com'],
        }),
      ],
    })
    render(<ReviewMergesScreen />)

    await user.click(screen.getByText('user@example.com'))
    await user.click(screen.getByLabelText('Select https://b.example.com'))
    await user.click(screen.getByRole('button', { name: 'Split selected' }))

    const rows = get().reviewAccounts
    expect(rows).toHaveLength(2)
    expect(rows[0].urls).toEqual(['https://a.example.com', 'https://c.example.com'])
    expect(rows[1].urls).toEqual(['https://b.example.com'])
  })

  it('disables split-selected with nothing checked, or everything checked', async () => {
    const user = userEvent.setup()
    useWizardStore.setState({
      reviewAccounts: [
        makeReviewAccount({ id: 'r1', urls: ['https://a.example.com', 'https://b.example.com'] }),
      ],
    })
    render(<ReviewMergesScreen />)
    await user.click(screen.getByText('user@example.com'))

    expect(screen.getByRole('button', { name: 'Split selected' })).toBeDisabled()

    await user.click(screen.getByLabelText('Select https://a.example.com'))
    expect(screen.getByRole('button', { name: 'Split selected' })).toBeEnabled()

    await user.click(screen.getByLabelText('Select https://b.example.com'))
    expect(screen.getByRole('button', { name: 'Split selected' })).toBeDisabled()
  })

  it('regroups two split-off rows that share a group key', async () => {
    const user = userEvent.setup()
    useWizardStore.setState({
      reviewAccounts: [
        makeReviewAccount({ id: 's1', urls: ['https://a.example.com'], origin: 'split' }),
        makeReviewAccount({ id: 's2', urls: ['https://b.example.com'], origin: 'split' }),
      ],
    })
    render(<ReviewMergesScreen />)

    const [first, second] = screen.getAllByLabelText('Select for regroup')
    await user.click(first)
    await user.click(second)
    await user.click(screen.getByRole('button', { name: 'Regroup selected (2)' }))

    expect(get().reviewAccounts).toHaveLength(1)
    expect(get().reviewAccounts[0].urls).toEqual(['https://a.example.com', 'https://b.example.com'])
  })

  it('offers a disabled regroup button for rows from different group keys', async () => {
    const user = userEvent.setup()
    useWizardStore.setState({
      reviewAccounts: [
        makeReviewAccount({ id: 's1', domain: 'a.com', urls: ['https://a.com'], origin: 'split' }),
        makeReviewAccount({ id: 's2', domain: 'b.com', urls: ['https://b.com'], origin: 'split' }),
      ],
    })
    render(<ReviewMergesScreen />)

    const boxes = screen.getAllByLabelText('Select for regroup')
    await user.click(boxes[0])
    await user.click(boxes[1])
    expect(screen.getByRole('button', { name: 'Regroup selected' })).toBeDisabled()
  })

  it('only offers regroup checkboxes on split-off rows', () => {
    useWizardStore.setState({
      reviewAccounts: [
        makeReviewAccount({ id: 'orig', origin: 'original' }),
        makeReviewAccount({ id: 's1', origin: 'split', urls: ['https://a.example.com'] }),
      ],
    })
    render(<ReviewMergesScreen />)
    expect(screen.getAllByLabelText('Select for regroup')).toHaveLength(1)
  })

  it('enables undo only after an edit, and rewinds it', async () => {
    const user = userEvent.setup()
    useWizardStore.setState({ reviewAccounts: [makeReviewAccount({ id: 'r1' })] })
    render(<ReviewMergesScreen />)

    expect(screen.getByRole('button', { name: /Undo/ })).toBeDisabled()

    await user.click(screen.getByText('user@example.com'))
    await user.click(screen.getByRole('button', { name: 'Split all apart' }))
    expect(get().reviewAccounts).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: /Undo/ }))
    expect(get().reviewAccounts).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Undo/ })).toBeDisabled()
  })

  it('commits the reviewed rows and moves on', async () => {
    const user = userEvent.setup()
    useWizardStore.setState({
      step: 'review-merges',
      mergedAccounts: [makeMergedAccount({ normalizedDomain: 'plain.com' }), makeSubdomainMerge()],
    })
    render(<ReviewMergesScreen />)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(get().step).toBe('triage-card')
    expect(get().mergedAccounts.map(a => a.normalizedDomain)).toEqual(['plain.com', 'example.com'])
  })

  it('keep all merged advances without splitting, even for interesting merges', async () => {
    const user = userEvent.setup()
    useWizardStore.setState({
      step: 'review-merges',
      mergedAccounts: [makeSubdomainMerge({ subdomainIsInteresting: true })],
    })
    render(<ReviewMergesScreen />)
    await user.click(screen.getByRole('button', { name: 'Keep all merged' }))

    expect(get().step).toBe('triage-card')
    expect(get().mergedAccounts).toHaveLength(1)
    expect(get().mergedAccounts[0].isSubdomainMerge).toBe(true)
  })

  it('groups accounts under a single header per top-level domain', () => {
    useWizardStore.setState({
      step: 'review-merges',
      mergedAccounts: [
        makeSubdomainMerge({ subdomainIsInteresting: true, username: 'a@x.com' }),
        makeSubdomainMerge({ subdomainIsInteresting: true, username: 'b@x.com' }),
      ],
    })
    render(<ReviewMergesScreen />)
    expect(screen.getAllByRole('heading', { level: 3, name: /example\.com/ })).toHaveLength(1)
    expect(screen.getByText(/2 accounts/)).toBeInTheDocument()
  })

  // The "Nothing to show with the current filter." branch is unreachable: `visible` is
  // either `reviewAccounts` (show-all) or `interesting`, and an empty `interesting` with
  // a non-empty `reviewAccounts` is caught earlier by the auto-advance screen. Asserting
  // the reachable half of that: an all-boring list renders the auto-advance state, never
  // an empty list.
  it('never renders a bare empty list when every merge is filtered out', () => {
    vi.useFakeTimers()
    useWizardStore.setState({
      reviewAccounts: [makeReviewAccount({ id: 'boring', fromInterestingMerge: false })],
    })
    render(<ReviewMergesScreen />)
    expect(screen.queryByText('Nothing to show with the current filter.')).not.toBeInTheDocument()
    expect(screen.getByText('Moving on…')).toBeInTheDocument()
  })

  it('labels a row with no username', () => {
    useWizardStore.setState({ reviewAccounts: [makeReviewAccount({ username: '' })] })
    render(<ReviewMergesScreen />)
    expect(screen.getAllByText('(no username)').length).toBeGreaterThan(0)
  })

  it('does not expand a single-url row', async () => {
    const user = userEvent.setup()
    useWizardStore.setState({
      reviewAccounts: [makeReviewAccount({ id: 'r1', urls: ['https://only.example.com'] })],
    })
    render(<ReviewMergesScreen />)
    await user.click(screen.getByText('user@example.com'))
    expect(screen.queryByRole('button', { name: 'Split all apart' })).not.toBeInTheDocument()
  })

  it('goes back through the wizard history', async () => {
    const user = userEvent.setup()
    useWizardStore.setState({
      history: ['import-summary'],
      reviewAccounts: [makeReviewAccount()],
    })
    render(<ReviewMergesScreen />)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(get().step).toBe('import-summary')
  })

  it('keeps each row self-contained', () => {
    useWizardStore.setState({
      reviewAccounts: [
        makeReviewAccount({ id: 'r1', domain: 'first.com', username: 'u1', urls: ['https://one.first.com', 'https://two.first.com'] }),
        makeReviewAccount({ id: 'r2', domain: 'second.com', username: 'u2', urls: ['https://one.second.com'] }),
      ],
    })
    render(<ReviewMergesScreen />)
    const card = screen.getByText('u1').closest<HTMLElement>('[data-slot="card"]')!
    expect(within(card).getByText('2 combined')).toBeInTheDocument()
    expect(within(card).queryByText('u2')).not.toBeInTheDocument()
  })
})
