import { create } from 'zustand'

export type WizardStep = 'welcome' | 'import' | 'triage' | 'execute' | 'done'

const STEPS: WizardStep[] = ['welcome', 'import', 'triage', 'execute', 'done']

interface WizardStore {
  step: WizardStep
  advance: () => void
  reset: () => void
}

export const useWizardStore = create<WizardStore>((set, get) => ({
  step: 'welcome',
  advance: () => {
    const idx = STEPS.indexOf(get().step)
    if (idx < STEPS.length - 1) set({ step: STEPS[idx + 1] })
  },
  reset: () => set({ step: 'welcome' }),
}))
