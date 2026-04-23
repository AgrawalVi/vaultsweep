import { useEffect } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import './App.css'
import { AppShell } from './components/shell/AppShell'
import { WelcomeScreen } from './components/wizard/WelcomeScreen'
import { ConnectSourcesScreen } from './components/wizard/ConnectSourcesScreen'
import { ImportSummaryScreen } from './components/wizard/ImportSummaryScreen'
import { MergeConflictScreen } from './components/wizard/MergeConflictScreen'
import { ReviewMergesScreen } from './components/wizard/ReviewMergesScreen'
import { TriageCardScreen } from './components/wizard/TriageCardScreen'
import { TriageCompleteScreen } from './components/wizard/TriageCompleteScreen'
import { CsvEntriesDebug } from './components/debug/CsvEntriesDebug'
import { useWizardStore, type WizardStep } from './lib/store'
import { openDebugCsvWindow } from './lib/tauri'

const screens: Record<WizardStep, React.ReactNode> = {
  'welcome': <WelcomeScreen />,
  'connect-sources': <ConnectSourcesScreen />,
  'import-summary': <ImportSummaryScreen />,
  'merge-conflict': <MergeConflictScreen />,
  'review-merges': <ReviewMergesScreen />,
  'triage-card': <TriageCardScreen />,
  'triage-complete': <TriageCompleteScreen />,
}

const IS_DEBUG_CSV = window.location.hash === '#debug-csv'

function App() {
  const step = useWizardStore(s => s.step)
  const rawEntries = useWizardStore(s => s.rawEntries)
  const mergedAccounts = useWizardStore(s => s.mergedAccounts)

  // Bridge: emit raw entries and merged accounts to debug windows whenever they change
  useEffect(() => {
    emit('debug:raw-entries-updated', { entries: rawEntries }).catch(() => {})
  }, [rawEntries])

  useEffect(() => {
    emit('debug:merged-accounts-updated', { accounts: mergedAccounts }).catch(() => {})
  }, [mergedAccounts])

  // Bridge: respond to debug windows requesting the current data
  useEffect(() => {
    const unlistenEntries = listen('debug:request-raw-entries', () => {
      emit('debug:raw-entries-updated', { entries: rawEntries }).catch(() => {})
    })
    const unlistenAccounts = listen('debug:request-merged-accounts', () => {
      emit('debug:merged-accounts-updated', { accounts: mergedAccounts }).catch(() => {})
    })
    return () => {
      unlistenEntries.then(u => u())
      unlistenAccounts.then(u => u())
    }
  }, [rawEntries, mergedAccounts])

  // Cmd+Shift+D opens the CSV debug window
  useEffect(() => {
    if (IS_DEBUG_CSV) return
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        openDebugCsvWindow().catch(() => {})
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (IS_DEBUG_CSV) return <CsvEntriesDebug />

  return <AppShell>{screens[step]}</AppShell>
}

export default App
