import { create } from 'zustand'
import { parseCsvs, mergeEntries } from '@/lib/tauri'
import {
  applyConflictResolutions,
  buildReviewAccounts,
  recomputeRawEntries,
  regroup,
  reviewToMergedAccount,
  splitAll,
  splitSelected,
  suggestUploadName,
  urlSubsetId,
} from '@/lib/wizard-logic'
import type { BrowserFormat, ImportTarget, MergedAccount, RawEntry, SourceError } from '@/types/parser'
import type { ConflictResolution, ReviewAccount, UploadedSource } from '@/lib/wizard-logic'

// Re-exported so existing `@/lib/store` import sites keep working after the extraction.
export { CATEGORY_DEFAULT_NAME } from '@/lib/wizard-logic'
export type { ConflictResolution, ReviewAccount, UploadedSource } from '@/lib/wizard-logic'

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

export type TriageDecision = 'keep' | 'delete' | 'skip'

type TriageDecisions = Record<TriageDecision, number>

function newUploadId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
  /** Latest decision per `MergedAccount.id`. Session Phase 2 builds its lists from this. */
  triageDecisionById: Record<string, TriageDecision>

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

  decideTriage: (d: TriageDecision) => void
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
  triageDecisionById: {},

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
  triageDecisionById: {},
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
    const rows = splitAll(reviewAccounts, rowId)
    if (!rows) return
    set({ reviewAccounts: rows, reviewUndoStack: [...reviewUndoStack, reviewAccounts] })
  },

  splitReviewSelected: (rowId, urls) => {
    const { reviewAccounts, reviewUndoStack } = get()
    const rows = splitSelected(reviewAccounts, rowId, urls)
    if (!rows) return
    set({ reviewAccounts: rows, reviewUndoStack: [...reviewUndoStack, reviewAccounts] })
  },

  regroupReview: rowIds => {
    const { reviewAccounts, reviewUndoStack } = get()
    const rows = regroup(reviewAccounts, rowIds, Date.now())
    if (!rows) return
    set({ reviewAccounts: rows, reviewUndoStack: [...reviewUndoStack, reviewAccounts] })
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
            id: urlSubsetId(a.id, [url]),
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
    const { triageIndex, triageDecisions, triageDecisionById, mergedAccounts, advance } = get()
    const account = mergedAccounts[triageIndex]
    if (!account) return
    const next = triageIndex + 1
    set({
      triageIndex: next,
      triageDecisions: { ...triageDecisions, [d]: triageDecisions[d] + 1 },
      triageDecisionById: { ...triageDecisionById, [account.id]: d },
    })
    if (next >= mergedAccounts.length) advance()
  },
}))
