import { create } from 'zustand'

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

export const FAKE_ACCOUNTS_PER_SOURCE: Record<string, number> = {
  icloud: 74,
  chrome: 52,
  arc: 31,
}
export const FAKE_DUPLICATES = 18
export const FAKE_CONFLICT_COUNT = 3
export const FAKE_TRIAGE_COUNT = 8

interface TriageDecisions {
  keep: number
  delete: number
  skip: number
}

interface WizardStore {
  step: WizardStep
  history: WizardStep[]

  // ConnectSources
  connectedSources: string[]
  fakeAccountsFound: number

  // MergeConflict
  mergeConflictIndex: number

  // Triage
  triageIndex: number
  triageDecisions: TriageDecisions

  advance: () => void
  back: () => void
  reset: () => void

  connectSource: (id: string) => void
  pickMergeCandidate: () => void
  decideTriage: (d: 'keep' | 'delete' | 'skip') => void
}

export const useWizardStore = create<WizardStore>((set, get) => ({
  step: 'welcome',
  history: [],

  connectedSources: [],
  fakeAccountsFound: 0,

  mergeConflictIndex: 0,

  triageIndex: 0,
  triageDecisions: { keep: 0, delete: 0, skip: 0 },

  advance: () => {
    const { step, history } = get()
    const idx = STEPS.indexOf(step)
    if (idx < STEPS.length - 1) {
      set({ step: STEPS[idx + 1], history: [...history, step] })
    }
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
      connectedSources: [],
      fakeAccountsFound: 0,
      mergeConflictIndex: 0,
      triageIndex: 0,
      triageDecisions: { keep: 0, delete: 0, skip: 0 },
    }),

  connectSource: (id: string) => {
    const { connectedSources, fakeAccountsFound } = get()
    if (connectedSources.includes(id)) return
    set({
      connectedSources: [...connectedSources, id],
      fakeAccountsFound: fakeAccountsFound + (FAKE_ACCOUNTS_PER_SOURCE[id] ?? 0),
    })
  },

  pickMergeCandidate: () => {
    const { mergeConflictIndex, advance } = get()
    const next = mergeConflictIndex + 1
    if (next >= FAKE_CONFLICT_COUNT) {
      set({ mergeConflictIndex: next })
      advance()
    } else {
      set({ mergeConflictIndex: next })
    }
  },

  decideTriage: (d: 'keep' | 'delete' | 'skip') => {
    const { triageIndex, triageDecisions, advance } = get()
    const next = triageIndex + 1
    const updated = { ...triageDecisions, [d]: triageDecisions[d] + 1 }
    if (next >= FAKE_TRIAGE_COUNT) {
      set({ triageIndex: next, triageDecisions: updated })
      advance()
    } else {
      set({ triageIndex: next, triageDecisions: updated })
    }
  },
}))
