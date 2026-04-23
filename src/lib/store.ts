import { create } from 'zustand'
import { parseCsvs, mergeEntries } from '@/lib/tauri'
import type { BrowserFormat, ImportTarget, MergedAccount, RawEntry, SourceError } from '@/types/parser'

export type WizardStep =
  | 'welcome'
  | 'connect-sources'
  | 'import-summary'
  | 'merge-conflict'
  | 'triage-card'
  | 'triage-complete'

const STEPS: WizardStep[] = [
  'welcome',
  'connect-sources',
  'import-summary',
  'merge-conflict',
  'triage-card',
  'triage-complete',
]

export const SOURCE_FORMAT: Record<string, BrowserFormat> = {
  icloud: 'icloud',
  chrome: 'chromium',
  arc: 'chromium',
}

interface TriageDecisions {
  keep: number
  delete: number
  skip: number
}

interface WizardStore {
  step: WizardStep
  history: WizardStep[]

  // ConnectSources — per-source state
  sourceCounts: Record<string, number>
  sourceErrors: Record<string, string>
  sourcePending: Record<string, boolean>
  rawEntries: RawEntry[]

  // ImportSummary — post-merge
  mergedAccounts: MergedAccount[]
  mergeError: string | null
  mergePending: boolean

  // MergeConflict
  mergeConflictIndex: number
  conflictResolutions: Record<number, number>

  // Triage
  triageIndex: number
  triageDecisions: TriageDecisions

  advance: () => void
  back: () => void
  reset: () => void

  addSource: (id: string, target: ImportTarget) => Promise<void>
  runMerge: () => Promise<void>
  resolveConflict: (accountIdx: number, passwordIdx: number) => void
  decideTriage: (d: 'keep' | 'delete' | 'skip') => void
}

export const useWizardStore = create<WizardStore>((set, get) => ({
  step: 'welcome',
  history: [],

  sourceCounts: {},
  sourceErrors: {},
  sourcePending: {},
  rawEntries: [],

  mergedAccounts: [],
  mergeError: null,
  mergePending: false,

  mergeConflictIndex: 0,
  conflictResolutions: {},

  triageIndex: 0,
  triageDecisions: { keep: 0, delete: 0, skip: 0 },

  advance: () => {
    const { step, history, mergedAccounts } = get()
    const idx = STEPS.indexOf(step)
    if (idx >= STEPS.length - 1) return

    let nextIdx = idx + 1
    // Skip merge-conflict if no conflicts
    if (STEPS[nextIdx] === 'merge-conflict' && !mergedAccounts.some(a => a.hasConflict)) {
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
      sourceCounts: {},
      sourceErrors: {},
      sourcePending: {},
      rawEntries: [],
      mergedAccounts: [],
      mergeError: null,
      mergePending: false,
      mergeConflictIndex: 0,
      conflictResolutions: {},
      triageIndex: 0,
      triageDecisions: { keep: 0, delete: 0, skip: 0 },
    }),

  addSource: async (id, target) => {
    set(s => ({ sourcePending: { ...s.sourcePending, [id]: true }, sourceErrors: { ...s.sourceErrors, [id]: '' } }))
    try {
      const result = await parseCsvs([target])
      set(s => {
        // Remove previous entries from this source, then add new ones
        const filtered = s.rawEntries.filter(e => e.source !== target.name)
        const merged = [...filtered, ...result.entries]
        const errors = { ...s.sourceErrors }
        if (result.errors.length > 0) {
          errors[id] = result.errors.map((e: SourceError) => e.message).join('; ')
        } else {
          delete errors[id]
        }
        return {
          sourceCounts: { ...s.sourceCounts, [id]: result.entries.length },
          sourceErrors: errors,
          sourcePending: { ...s.sourcePending, [id]: false },
          rawEntries: merged,
        }
      })
    } catch (err) {
      set(s => ({
        sourceErrors: { ...s.sourceErrors, [id]: String(err) },
        sourcePending: { ...s.sourcePending, [id]: false },
      }))
    }
  },

  runMerge: async () => {
    const { rawEntries } = get()
    set({ mergePending: true, mergeError: null })
    try {
      const accounts = await mergeEntries(rawEntries)
      set({ mergedAccounts: accounts, mergePending: false })
    } catch (err) {
      set({ mergeError: String(err), mergePending: false })
    }
  },

  resolveConflict: (accountIdx, passwordIdx) => {
    const { mergeConflictIndex, mergedAccounts, conflictResolutions, advance } = get()
    const conflicts = mergedAccounts.filter(a => a.hasConflict)
    const updatedResolutions = { ...conflictResolutions, [accountIdx]: passwordIdx }
    const next = mergeConflictIndex + 1
    set({ conflictResolutions: updatedResolutions })
    if (next >= conflicts.length) {
      advance()
    } else {
      set({ mergeConflictIndex: next })
    }
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
