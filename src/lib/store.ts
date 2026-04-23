import { create } from 'zustand'
import { parseCsvs, mergeEntries } from '@/lib/tauri'
import type { BrowserFormat, ImportTarget, MergedAccount, PasswordEntry, RawEntry, SourceError } from '@/types/parser'

export type WizardStep =
  | 'welcome'
  | 'connect-sources'
  | 'import-summary'
  | 'merge-conflict'
  | 'review-merges'
  | 'triage-card'
  | 'triage-complete'

const STEPS: WizardStep[] = [
  'welcome',
  'connect-sources',
  'import-summary',
  'merge-conflict',
  'review-merges',
  'triage-card',
  'triage-complete',
]

interface TriageDecisions {
  keep: number
  delete: number
  skip: number
}

/** One CSV file the user added under a category. Multiple uploads per category are allowed.
 *  `name` is user-editable and becomes the source label shown in triage and the merger. */
export interface UploadedSource {
  id: string
  category: BrowserFormat
  name: string
  path: string
  entries: RawEntry[]
  error: string | null
  pending: boolean
}

export const CATEGORY_DEFAULT_NAME: Record<BrowserFormat, string> = {
  icloud: 'Safari',
  chromium: 'Chrome',
  firefox: 'Firefox',
}

function suggestUploadName(uploads: UploadedSource[], category: BrowserFormat): string {
  const base = CATEGORY_DEFAULT_NAME[category]
  const existing = uploads.filter(u => u.category === category).length
  return existing === 0 ? base : `${base} (${existing + 1})`
}

function recomputeRawEntries(uploads: UploadedSource[]): RawEntry[] {
  return uploads.flatMap(u => u.entries.map(e => ({ ...e, source: u.name })))
}

function newUploadId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export type ConflictResolution =
  | { kind: 'combine'; passwordIdx: number }
  | { kind: 'separate' }
  | { kind: 'discard' }

export interface ReviewAccount {
  id: string
  /** `${domain}|${username}` — identifies rows that can be regrouped together. */
  groupKey: string
  domain: string
  username: string
  title: string | null
  notes: string | null
  otpAuth: string | null
  sources: string[]
  passwords: PasswordEntry[]
  /** The subset of URLs represented by this row. For an untouched row this equals
   *  the full `allUrls` of the source merged account. After a split it holds one URL. */
  urls: string[]
  origin: 'original' | 'split'
  /** Only meaningful for originals: was the underlying merge "interesting"? Drives the
   *  default-view filter on the Review Merges screen. */
  fromInterestingMerge: boolean
}

function accountKey(a: Pick<MergedAccount, 'normalizedDomain' | 'username'>): string {
  return `${a.normalizedDomain}|${a.username}`
}

function buildReviewAccounts(accounts: MergedAccount[]): ReviewAccount[] {
  return accounts
    .filter(a => a.isSubdomainMerge)
    .map((a, i) => ({
      id: `orig-${i}-${accountKey(a)}`,
      groupKey: accountKey(a),
      domain: a.normalizedDomain,
      username: a.username,
      title: a.title,
      notes: a.notes,
      otpAuth: a.otpAuth,
      sources: [...a.sources],
      passwords: a.passwords.map(p => ({ ...p })),
      urls: [...a.allUrls],
      origin: 'original' as const,
      fromInterestingMerge: a.subdomainIsInteresting,
    }))
}

function reviewToMergedAccount(r: ReviewAccount): MergedAccount {
  return {
    normalizedDomain: r.domain,
    username: r.username,
    sources: r.sources,
    title: r.title,
    notes: r.notes,
    otpAuth: r.otpAuth,
    passwords: r.passwords,
    hasConflict: false,
    allUrls: r.urls,
    isSubdomainMerge: r.urls.length > 1,
    subdomainIsInteresting: r.urls.length > 1 && r.fromInterestingMerge,
  }
}

/** Apply user's conflict resolutions to produce a flat, conflict-free list plus the
 *  list of accounts the user chose to discard (deferred to Phase 2 deletion review). */
function applyConflictResolutions(
  accounts: MergedAccount[],
  resolutions: Record<number, ConflictResolution>,
): { resolved: MergedAccount[]; discarded: MergedAccount[] } {
  const resolved: MergedAccount[] = []
  const discarded: MergedAccount[] = []
  accounts.forEach((account, idx) => {
    if (!account.hasConflict) {
      resolved.push(account)
      return
    }
    const r = resolutions[idx] ?? { kind: 'combine' as const, passwordIdx: 0 }
    if (r.kind === 'combine') {
      const chosen = account.passwords[r.passwordIdx] ?? account.passwords[0]
      resolved.push({ ...account, passwords: [chosen], hasConflict: false })
    } else if (r.kind === 'separate') {
      account.passwords.forEach(pw => {
        const url = pw.url ?? null
        resolved.push({
          ...account,
          sources: [pw.source],
          passwords: [pw],
          allUrls: url ? [url] : account.allUrls,
          hasConflict: false,
          isSubdomainMerge: false,
          subdomainIsInteresting: false,
        })
      })
    } else {
      discarded.push(account)
    }
  })
  return { resolved, discarded }
}

interface WizardStore {
  step: WizardStep
  history: WizardStep[]

  uploads: UploadedSource[]
  rawEntries: RawEntry[]

  /** Raw merger output, preserved so we can re-derive resolutions if the user goes Back. */
  rawMergedAccounts: MergedAccount[]
  /** Working list used by every downstream step (review, triage). Updated after
   *  conflict resolution and again after Review Merges commit. */
  mergedAccounts: MergedAccount[]
  /** Accounts the user discarded in the conflict screen. Handed off to Phase 2. */
  discardedAccounts: MergedAccount[]
  mergeError: string | null
  mergePending: boolean

  // Merge conflict
  mergeConflictIndex: number
  conflictResolutions: Record<number, ConflictResolution>

  // Review merges
  reviewAccounts: ReviewAccount[]
  reviewUndoStack: ReviewAccount[][]
  reviewShowAll: boolean

  // Triage
  triageIndex: number
  triageDecisions: TriageDecisions

  advance: () => void
  back: () => void
  reset: () => void

  addUpload: (category: BrowserFormat, path: string) => Promise<void>
  renameUpload: (id: string, name: string) => void
  removeUpload: (id: string) => void
  runMerge: () => Promise<void>

  resolveConflict: (accountIdx: number, resolution: ConflictResolution) => void

  initializeReview: () => void
  setReviewShowAll: (v: boolean) => void
  splitReviewAll: (rowId: string) => void
  splitReviewSelected: (rowId: string, urls: string[]) => void
  regroupReview: (rowIds: string[]) => void
  undoReview: () => void
  commitReview: () => void
  skipReview: () => void

  decideTriage: (d: 'keep' | 'delete' | 'skip') => void
}

export const useWizardStore = create<WizardStore>((set, get) => ({
  step: 'welcome',
  history: [],

  uploads: [],
  rawEntries: [],

  rawMergedAccounts: [],
  mergedAccounts: [],
  discardedAccounts: [],
  mergeError: null,
  mergePending: false,

  mergeConflictIndex: 0,
  conflictResolutions: {},

  reviewAccounts: [],
  reviewUndoStack: [],
  reviewShowAll: false,

  triageIndex: 0,
  triageDecisions: { keep: 0, delete: 0, skip: 0 },

  advance: () => {
    const { step, history, mergedAccounts, rawMergedAccounts } = get()
    const idx = STEPS.indexOf(step)
    if (idx >= STEPS.length - 1) return

    let nextIdx = idx + 1
    let next = STEPS[nextIdx]

    if (next === 'merge-conflict' && !rawMergedAccounts.some(a => a.hasConflict)) {
      nextIdx += 1
      next = STEPS[nextIdx]
    }
    if (next === 'review-merges' && !mergedAccounts.some(a => a.isSubdomainMerge)) {
      nextIdx += 1
    }
    set({ step: STEPS[nextIdx], history: [...history, step] })
  },

  back: () => {
    const { history } = get()
    if (history.length === 0) return
    const prev = history[history.length - 1]
    set({ step: prev, history: history.slice(0, -1) })
  },

  reset: () =>
    set({
      step: 'welcome',
      history: [],
      uploads: [],
      rawEntries: [],
      rawMergedAccounts: [],
      mergedAccounts: [],
      discardedAccounts: [],
      mergeError: null,
      mergePending: false,
      mergeConflictIndex: 0,
      conflictResolutions: {},
      reviewAccounts: [],
      reviewUndoStack: [],
      reviewShowAll: false,
      triageIndex: 0,
      triageDecisions: { keep: 0, delete: 0, skip: 0 },
    }),

  addUpload: async (category, path) => {
    const id = newUploadId()
    const name = suggestUploadName(get().uploads, category)
    const placeholder: UploadedSource = {
      id,
      category,
      name,
      path,
      entries: [],
      error: null,
      pending: true,
    }
    set(s => ({ uploads: [...s.uploads, placeholder] }))

    const target: ImportTarget = { format: category, name, path }
    try {
      const result = await parseCsvs([target])
      const errorMsg = result.errors.length > 0
        ? result.errors.map((e: SourceError) => e.message).join('; ')
        : null
      set(s => {
        const uploads = s.uploads.map(u =>
          u.id === id ? { ...u, entries: result.entries, error: errorMsg, pending: false } : u,
        )
        return { uploads, rawEntries: recomputeRawEntries(uploads) }
      })
    } catch (err) {
      set(s => {
        const uploads = s.uploads.map(u =>
          u.id === id ? { ...u, error: String(err), pending: false } : u,
        )
        return { uploads, rawEntries: recomputeRawEntries(uploads) }
      })
    }
  },

  renameUpload: (id, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    set(s => {
      const uploads = s.uploads.map(u => (u.id === id ? { ...u, name: trimmed } : u))
      return { uploads, rawEntries: recomputeRawEntries(uploads) }
    })
  },

  removeUpload: id => {
    set(s => {
      const uploads = s.uploads.filter(u => u.id !== id)
      return { uploads, rawEntries: recomputeRawEntries(uploads) }
    })
  },

  runMerge: async () => {
    const { rawEntries } = get()
    set({ mergePending: true, mergeError: null })
    try {
      const accounts = await mergeEntries(rawEntries)
      set({
        rawMergedAccounts: accounts,
        mergedAccounts: accounts,
        discardedAccounts: [],
        conflictResolutions: {},
        mergeConflictIndex: 0,
        reviewAccounts: [],
        reviewUndoStack: [],
        mergePending: false,
      })
    } catch (err) {
      set({ mergeError: String(err), mergePending: false })
    }
  },

  resolveConflict: (accountIdx, resolution) => {
    const { mergeConflictIndex, rawMergedAccounts, conflictResolutions, advance } = get()
    const conflicts = rawMergedAccounts
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.hasConflict)

    const updated = { ...conflictResolutions, [accountIdx]: resolution }
    const next = mergeConflictIndex + 1

    if (next >= conflicts.length) {
      const { resolved, discarded } = applyConflictResolutions(rawMergedAccounts, updated)
      set({
        conflictResolutions: updated,
        mergedAccounts: resolved,
        discardedAccounts: discarded,
        reviewAccounts: [],
        reviewUndoStack: [],
      })
      advance()
    } else {
      set({ conflictResolutions: updated, mergeConflictIndex: next })
    }
  },

  initializeReview: () => {
    const { reviewAccounts, mergedAccounts } = get()
    if (reviewAccounts.length > 0) return
    set({ reviewAccounts: buildReviewAccounts(mergedAccounts), reviewUndoStack: [] })
  },

  setReviewShowAll: v => set({ reviewShowAll: v }),

  splitReviewAll: rowId => {
    const { reviewAccounts, reviewUndoStack } = get()
    const row = reviewAccounts.find(r => r.id === rowId)
    if (!row || row.urls.length <= 1) return
    const rows = reviewAccounts.flatMap(r => {
      if (r.id !== rowId) return [r]
      return r.urls.map((u, i) => ({
        ...r,
        id: `split-${rowId}-${i}-${u}`,
        urls: [u],
        origin: 'split' as const,
      }))
    })
    set({ reviewAccounts: rows, reviewUndoStack: [...reviewUndoStack, reviewAccounts] })
  },

  splitReviewSelected: (rowId, urls) => {
    const { reviewAccounts, reviewUndoStack } = get()
    const row = reviewAccounts.find(r => r.id === rowId)
    if (!row) return
    const peeled = urls.filter(u => row.urls.includes(u))
    if (peeled.length === 0 || peeled.length === row.urls.length) return
    const remaining = row.urls.filter(u => !peeled.includes(u))

    const out: ReviewAccount[] = []
    for (const r of reviewAccounts) {
      if (r.id !== rowId) {
        out.push(r)
        continue
      }
      out.push({ ...r, urls: remaining })
      peeled.forEach((u, i) => {
        out.push({
          ...r,
          id: `split-${rowId}-${i}-${u}`,
          urls: [u],
          origin: 'split' as const,
        })
      })
    }
    set({ reviewAccounts: out, reviewUndoStack: [...reviewUndoStack, reviewAccounts] })
  },

  regroupReview: rowIds => {
    const { reviewAccounts, reviewUndoStack } = get()
    const targets = reviewAccounts.filter(r => rowIds.includes(r.id))
    if (targets.length < 2) return
    const key = targets[0].groupKey
    if (!targets.every(t => t.groupKey === key)) return

    const base = targets[0]
    const mergedUrls: string[] = []
    for (const t of targets) for (const u of t.urls) if (!mergedUrls.includes(u)) mergedUrls.push(u)
    const combined: ReviewAccount = {
      ...base,
      id: `regroup-${Date.now()}-${key}`,
      urls: mergedUrls,
      origin: 'split',
    }

    const firstIdx = reviewAccounts.findIndex(r => rowIds.includes(r.id))
    const filtered = reviewAccounts.filter(r => !rowIds.includes(r.id))
    filtered.splice(firstIdx, 0, combined)
    set({ reviewAccounts: filtered, reviewUndoStack: [...reviewUndoStack, reviewAccounts] })
  },

  undoReview: () => {
    const { reviewUndoStack } = get()
    if (reviewUndoStack.length === 0) return
    const prev = reviewUndoStack[reviewUndoStack.length - 1]
    set({ reviewAccounts: prev, reviewUndoStack: reviewUndoStack.slice(0, -1) })
  },

  commitReview: () => {
    const { reviewAccounts, mergedAccounts, advance } = get()
    const reshaped = reviewAccounts.map(reviewToMergedAccount)
    const untouched = mergedAccounts.filter(a => !a.isSubdomainMerge)
    set({ mergedAccounts: [...untouched, ...reshaped] })
    advance()
  },

  skipReview: () => {
    // Skip = auto-split interesting merges (the questionable ones), keep boring merges collapsed.
    const { mergedAccounts, advance } = get()
    const next: MergedAccount[] = []
    for (const a of mergedAccounts) {
      if (a.isSubdomainMerge && a.subdomainIsInteresting) {
        for (const url of a.allUrls) {
          next.push({
            ...a,
            allUrls: [url],
            isSubdomainMerge: false,
            subdomainIsInteresting: false,
          })
        }
      } else {
        next.push(a)
      }
    }
    set({ mergedAccounts: next })
    advance()
  },

  decideTriage: (d) => {
    const { triageIndex, triageDecisions, mergedAccounts, advance } = get()
    const next = triageIndex + 1
    const updated = { ...triageDecisions, [d]: triageDecisions[d] + 1 }
    if (next >= mergedAccounts.length) {
      set({ triageIndex: next, triageDecisions: updated })
      advance()
    } else {
      set({ triageIndex: next, triageDecisions: updated })
    }
  },
}))
