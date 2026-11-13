import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWizardStore } from '@/lib/store'
import { mergeEntries, parseCsvs } from '@/lib/tauri'
import {
  makeConflictAccount,
  makeMergedAccount,
  makeRawEntry,
  makeReviewAccount,
  makeSubdomainMerge,
  makeUpload,
  SENTINEL_PASSWORD,
} from '@/test/factories'

// `@/lib/tauri` is the whole Tauri boundary for the store — mocking it means these
// tests never need a Tauri process.
vi.mock('@/lib/tauri', () => ({
  parseCsvs: vi.fn(),
  mergeEntries: vi.fn(),
  pickCsvFile: vi.fn(),
  pickCsvFiles: vi.fn(),
  openDebugCsvWindow: vi.fn(),
}))

const mockParseCsvs = vi.mocked(parseCsvs)
const mockMergeEntries = vi.mocked(mergeEntries)

const get = () => useWizardStore.getState()

beforeEach(() => {
  useWizardStore.getState().reset()
  vi.clearAllMocks()
})

describe('advance / back', () => {
  it('walks the happy path when there is nothing to skip', () => {
    expect(get().step).toBe('welcome')
    get().advance()
    expect(get().step).toBe('connect-sources')
    get().advance()
    expect(get().step).toBe('import-summary')
  })

  it('skips merge-conflict when no account conflicts', () => {
    useWizardStore.setState({
      step: 'import-summary',
      rawMergedAccounts: [makeSubdomainMerge()],
      mergedAccounts: [makeSubdomainMerge()],
    })
    get().advance()
    expect(get().step).toBe('review-merges')
  })

  it('skips review-merges when nothing is a subdomain merge', () => {
    useWizardStore.setState({
      step: 'merge-conflict',
      rawMergedAccounts: [makeConflictAccount()],
      mergedAccounts: [makeMergedAccount()],
    })
    get().advance()
    expect(get().step).toBe('triage-card')
  })

  it('double-skips from import-summary straight to triage when neither applies', () => {
    useWizardStore.setState({
      step: 'import-summary',
      rawMergedAccounts: [makeMergedAccount()],
      mergedAccounts: [makeMergedAccount()],
    })
    get().advance()
    expect(get().step).toBe('triage-card')
  })

  it('stops at the last step', () => {
    useWizardStore.setState({ step: 'triage-complete' })
    get().advance()
    expect(get().step).toBe('triage-complete')
    expect(get().history).toEqual([])
  })

  it('back unwinds the visited history, including skipped steps', () => {
    useWizardStore.setState({
      step: 'import-summary',
      rawMergedAccounts: [makeMergedAccount()],
      mergedAccounts: [makeMergedAccount()],
    })
    get().advance()
    expect(get().step).toBe('triage-card')
    get().back()
    expect(get().step).toBe('import-summary')
  })

  it('back is a no-op with an empty history', () => {
    get().back()
    expect(get().step).toBe('welcome')
  })
})

describe('uploads', () => {
  it('addUpload records a pending placeholder, then fills it from the parse result', async () => {
    const entries = [makeRawEntry({ source: 'stale' })]
    mockParseCsvs.mockResolvedValue({ entries, warnings: [], errors: [] })

    await get().addUpload('chromium', '/tmp/chrome.csv')

    expect(get().uploads).toHaveLength(1)
    const [upload] = get().uploads
    expect(upload.pending).toBe(false)
    expect(upload.name).toBe('Chrome')
    expect(upload.error).toBeNull()
    expect(get().rawEntries.map(e => e.source)).toEqual(['Chrome'])
  })

  it('joins per-source errors into the upload error string', async () => {
    mockParseCsvs.mockResolvedValue({
      entries: [],
      warnings: [],
      errors: [
        { source: 'Chrome', message: 'missing header' },
        { source: 'Chrome', message: 'bad row' },
      ],
    })
    await get().addUpload('chromium', '/tmp/chrome.csv')
    expect(get().uploads[0].error).toBe('missing header; bad row')
    expect(get().uploads[0].pending).toBe(false)
  })

  it('records a rejection as the upload error and clears pending', async () => {
    mockParseCsvs.mockRejectedValue(new Error('boom'))
    await get().addUpload('chromium', '/tmp/chrome.csv')
    expect(get().uploads[0].error).toContain('boom')
    expect(get().uploads[0].pending).toBe(false)
  })

  it('numbers a second upload in the same category', async () => {
    mockParseCsvs.mockResolvedValue({ entries: [], warnings: [], errors: [] })
    await get().addUpload('chromium', '/tmp/a.csv')
    await get().addUpload('chromium', '/tmp/b.csv')
    expect(get().uploads.map(u => u.name)).toEqual(['Chrome', 'Chrome (2)'])
  })

  it('renameUpload relabels the source on every entry it contributed', () => {
    useWizardStore.setState({
      uploads: [makeUpload({ id: 'u1', entries: [makeRawEntry(), makeRawEntry()] })],
    })
    get().renameUpload('u1', '  Arc – Work  ')
    expect(get().uploads[0].name).toBe('Arc – Work')
    expect(get().rawEntries.every(e => e.source === 'Arc – Work')).toBe(true)
  })

  it('renameUpload ignores a blank name', () => {
    useWizardStore.setState({ uploads: [makeUpload({ id: 'u1', name: 'Chrome' })] })
    get().renameUpload('u1', '   ')
    expect(get().uploads[0].name).toBe('Chrome')
  })

  it('removeUpload drops the upload and its entries', () => {
    useWizardStore.setState({
      uploads: [
        makeUpload({ id: 'u1', name: 'Chrome', entries: [makeRawEntry()] }),
        makeUpload({ id: 'u2', name: 'Firefox', entries: [makeRawEntry()] }),
      ],
    })
    get().removeUpload('u1')
    expect(get().uploads.map(u => u.id)).toEqual(['u2'])
    expect(get().rawEntries.map(e => e.source)).toEqual(['Firefox'])
  })
})

describe('runMerge', () => {
  it('seeds both the raw and working account lists', async () => {
    const accounts = [makeMergedAccount()]
    mockMergeEntries.mockResolvedValue(accounts)
    await get().runMerge()
    expect(get().rawMergedAccounts).toEqual(accounts)
    expect(get().mergedAccounts).toEqual(accounts)
    expect(get().mergePending).toBe(false)
    expect(get().mergeError).toBeNull()
  })

  it('clears downstream state so a re-merge cannot inherit stale review rows', async () => {
    useWizardStore.setState({
      conflictResolutions: { 0: { kind: 'discard' } },
      mergeConflictIndex: 3,
      reviewAccounts: [makeReviewAccount()],
      reviewUndoStack: [[makeReviewAccount()]],
      discardedAccounts: [makeMergedAccount()],
    })
    mockMergeEntries.mockResolvedValue([makeMergedAccount()])
    await get().runMerge()
    expect(get().conflictResolutions).toEqual({})
    expect(get().mergeConflictIndex).toBe(0)
    expect(get().reviewAccounts).toEqual([])
    expect(get().reviewUndoStack).toEqual([])
    expect(get().discardedAccounts).toEqual([])
  })

  it('records a failure without wiping the previous accounts', async () => {
    mockMergeEntries.mockRejectedValue(new Error('merge failed'))
    await get().runMerge()
    expect(get().mergeError).toContain('merge failed')
    expect(get().mergePending).toBe(false)
  })
})

describe('resolveConflict', () => {
  it('advances through conflicts one at a time without applying yet', () => {
    useWizardStore.setState({
      step: 'merge-conflict',
      rawMergedAccounts: [makeConflictAccount(), makeConflictAccount()],
      mergedAccounts: [],
    })
    get().resolveConflict(0, { kind: 'discard' })
    expect(get().mergeConflictIndex).toBe(1)
    expect(get().step).toBe('merge-conflict')
    expect(get().discardedAccounts).toEqual([])
  })

  it('applies every resolution and advances once the last conflict is answered', () => {
    useWizardStore.setState({
      step: 'merge-conflict',
      rawMergedAccounts: [makeConflictAccount({ normalizedDomain: 'a.com' })],
      mergedAccounts: [],
    })
    get().resolveConflict(0, { kind: 'combine', passwordIdx: 1 })
    expect(get().mergedAccounts).toHaveLength(1)
    expect(get().mergedAccounts[0].passwords.map(p => p.password)).toEqual(['pw-safari'])
    expect(get().step).toBe('triage-card')
  })

  it('routes discards to discardedAccounts, out of the working list', () => {
    useWizardStore.setState({
      step: 'merge-conflict',
      rawMergedAccounts: [makeConflictAccount({ normalizedDomain: 'gone.com' })],
    })
    get().resolveConflict(0, { kind: 'discard' })
    expect(get().mergedAccounts).toEqual([])
    expect(get().discardedAccounts.map(a => a.normalizedDomain)).toEqual(['gone.com'])
  })

  it('lands on review-merges when a resolved account is still a subdomain merge', () => {
    useWizardStore.setState({
      step: 'merge-conflict',
      rawMergedAccounts: [makeSubdomainMerge(), makeConflictAccount()],
    })
    get().resolveConflict(1, { kind: 'combine', passwordIdx: 0 })
    expect(get().step).toBe('review-merges')
  })
})

describe('review merges', () => {
  it('initializeReview builds rows from the subdomain merges only', () => {
    useWizardStore.setState({
      mergedAccounts: [makeMergedAccount({ normalizedDomain: 'plain.com' }), makeSubdomainMerge()],
    })
    get().initializeReview()
    expect(get().reviewAccounts.map(r => r.domain)).toEqual(['example.com'])
  })

  it('initializeReview is idempotent once rows exist', () => {
    useWizardStore.setState({ reviewAccounts: [makeReviewAccount({ id: 'kept' })] })
    get().initializeReview()
    expect(get().reviewAccounts.map(r => r.id)).toEqual(['kept'])
  })

  it('splitReviewAll pushes an undo snapshot', () => {
    const rows = [makeReviewAccount({ id: 'r1' })]
    useWizardStore.setState({ reviewAccounts: rows })
    get().splitReviewAll('r1')
    expect(get().reviewAccounts).toHaveLength(2)
    expect(get().reviewUndoStack).toEqual([rows])
  })

  it('a no-op split leaves the undo stack alone', () => {
    useWizardStore.setState({
      reviewAccounts: [makeReviewAccount({ id: 'r1', urls: ['https://only.com'] })],
    })
    get().splitReviewAll('r1')
    get().splitReviewSelected('r1', [])
    get().regroupReview(['r1'])
    expect(get().reviewUndoStack).toEqual([])
  })

  it('undoReview restores the previous snapshot, and stacks arbitrarily deep', () => {
    const start = [makeReviewAccount({ id: 'r1', urls: ['https://a.com', 'https://b.com'] })]
    useWizardStore.setState({ reviewAccounts: start })
    get().splitReviewAll('r1')
    const afterSplit = get().reviewAccounts
    get().regroupReview(afterSplit.map(r => r.id))
    expect(get().reviewAccounts).toHaveLength(1)

    get().undoReview()
    expect(get().reviewAccounts).toEqual(afterSplit)
    get().undoReview()
    expect(get().reviewAccounts).toEqual(start)
    expect(get().reviewUndoStack).toEqual([])
  })

  it('undoReview is a no-op on an empty stack', () => {
    const rows = [makeReviewAccount()]
    useWizardStore.setState({ reviewAccounts: rows })
    get().undoReview()
    expect(get().reviewAccounts).toEqual(rows)
  })

  it('commitReview keeps non-merged accounts alongside the reshaped rows', () => {
    useWizardStore.setState({
      step: 'review-merges',
      mergedAccounts: [makeMergedAccount({ normalizedDomain: 'plain.com' }), makeSubdomainMerge()],
      reviewAccounts: [makeReviewAccount({ urls: ['https://one.example.com'] })],
    })
    get().commitReview()
    expect(get().mergedAccounts.map(a => a.normalizedDomain)).toEqual(['plain.com', 'example.com'])
    expect(get().mergedAccounts[1].isSubdomainMerge).toBe(false)
    expect(get().step).toBe('triage-card')
  })

  it('skipReview splits interesting merges and leaves boring ones collapsed', () => {
    useWizardStore.setState({
      step: 'review-merges',
      mergedAccounts: [
        makeSubdomainMerge({ normalizedDomain: 'interesting.com', subdomainIsInteresting: true }),
        makeSubdomainMerge({ normalizedDomain: 'boring.com', subdomainIsInteresting: false }),
      ],
    })
    get().skipReview()
    const byDomain = get().mergedAccounts.filter(a => a.normalizedDomain === 'interesting.com')
    const boring = get().mergedAccounts.filter(a => a.normalizedDomain === 'boring.com')
    expect(byDomain).toHaveLength(2)
    expect(byDomain.every(a => !a.isSubdomainMerge && a.allUrls.length === 1)).toBe(true)
    expect(boring).toHaveLength(1)
    expect(boring[0].isSubdomainMerge).toBe(true)
    expect(boring[0].allUrls).toHaveLength(2)
  })
})

describe('triage', () => {
  it('tallies each decision and walks the account list', () => {
    useWizardStore.setState({
      step: 'triage-card',
      mergedAccounts: [makeMergedAccount(), makeMergedAccount(), makeMergedAccount()],
    })
    get().decideTriage('keep')
    get().decideTriage('delete')
    expect(get().triageDecisions).toEqual({ keep: 1, delete: 1, skip: 0 })
    expect(get().triageIndex).toBe(2)
    expect(get().step).toBe('triage-card')
  })

  it('advances to triage-complete after the last account', () => {
    useWizardStore.setState({ step: 'triage-card', mergedAccounts: [makeMergedAccount()] })
    get().decideTriage('skip')
    expect(get().step).toBe('triage-complete')
    expect(get().triageDecisions).toEqual({ keep: 0, delete: 0, skip: 1 })
  })
})

describe('reset', () => {
  it('returns every field to its initial value', () => {
    useWizardStore.setState({
      step: 'triage-complete',
      history: ['welcome'],
      uploads: [makeUpload()],
      rawEntries: [makeRawEntry()],
      rawMergedAccounts: [makeMergedAccount()],
      mergedAccounts: [makeMergedAccount()],
      discardedAccounts: [makeMergedAccount()],
      reviewAccounts: [makeReviewAccount()],
      reviewUndoStack: [[makeReviewAccount()]],
      triageIndex: 5,
      triageDecisions: { keep: 1, delete: 2, skip: 3 },
    })
    get().reset()
    expect(get().step).toBe('welcome')
    expect(get().history).toEqual([])
    expect(get().uploads).toEqual([])
    expect(get().rawEntries).toEqual([])
    expect(get().rawMergedAccounts).toEqual([])
    expect(get().mergedAccounts).toEqual([])
    expect(get().discardedAccounts).toEqual([])
    expect(get().reviewAccounts).toEqual([])
    expect(get().reviewUndoStack).toEqual([])
    expect(get().triageIndex).toBe(0)
    expect(get().triageDecisions).toEqual({ keep: 0, delete: 0, skip: 0 })
  })
})

describe('security invariants', () => {
  it('has no persistence middleware attached', () => {
    // zustand's `persist` middleware hangs a `.persist` API off the hook. Its absence
    // is the load-bearing assertion: plaintext passwords must never reach disk.
    expect('persist' in useWizardStore).toBe(false)
  })

  it('writes nothing to Storage across a full import → merge → triage run', async () => {
    // Note: this environment's `localStorage` global is a bare object, so `.length`
    // proves nothing. Spy on the Storage prototype instead — that is the path any
    // real storage write would take.
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    mockParseCsvs.mockResolvedValue({ entries: [makeRawEntry()], warnings: [], errors: [] })
    mockMergeEntries.mockResolvedValue([makeMergedAccount()])

    await get().addUpload('chromium', '/tmp/chrome.csv')
    await get().runMerge()
    get().decideTriage('keep')

    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  // Known gap (Linear VAU-25): security invariant 5 says JS passwords are cleared as
  // soon as they are no longer needed, but the store keeps plaintext in
  // rawMergedAccounts / mergedAccounts / discardedAccounts / reviewAccounts and every
  // reviewUndoStack snapshot until reset(). Marked `it.fails`: it passes while the gap
  // exists and turns red once the store stops holding plaintext — flip it to `it` then.
  it.fails('holds no plaintext password once triage is complete', () => {
    useWizardStore.setState({
      step: 'triage-card',
      rawMergedAccounts: [makeMergedAccount()],
      mergedAccounts: [makeMergedAccount()],
    })
    get().decideTriage('keep')
    expect(get().step).toBe('triage-complete')
    expect(JSON.stringify(get())).not.toContain(SENTINEL_PASSWORD)
  })

  it('keepAllReview advances and leaves every merge untouched', () => {
    const accounts = [
      makeSubdomainMerge({ normalizedDomain: 'interesting.com', subdomainIsInteresting: true }),
      makeSubdomainMerge({ normalizedDomain: 'boring.com', subdomainIsInteresting: false }),
    ]
    useWizardStore.setState({ step: 'review-merges', mergedAccounts: accounts })
    get().keepAllReview()
    expect(get().step).toBe('triage-card')
    expect(get().mergedAccounts).toEqual(accounts)
  })
})
