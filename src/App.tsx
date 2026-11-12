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
import { DebugBridge } from './components/debug/DebugBridge'
import { useWizardStore, type WizardStep } from './lib/store'

const screens: Record<WizardStep, React.ReactNode> = {
  'welcome': <WelcomeScreen />,
  'connect-sources': <ConnectSourcesScreen />,
  'import-summary': <ImportSummaryScreen />,
  'merge-conflict': <MergeConflictScreen />,
  'review-merges': <ReviewMergesScreen />,
  'triage-card': <TriageCardScreen />,
  'triage-complete': <TriageCompleteScreen />,
}

function App() {
  const step = useWizardStore(s => s.step)

  // The debug window and its bridge mirror plaintext passwords between windows, so
  // they exist in dev builds only. Vite replaces `import.meta.env.DEV` with `false`
  // in production builds, which drops both from the release bundle.
  if (import.meta.env.DEV && window.location.hash === '#debug-csv') {
    return <CsvEntriesDebug />
  }

  return (
    <>
      {import.meta.env.DEV && <DebugBridge />}
      <AppShell>{screens[step]}</AppShell>
    </>
  )
}

export default App
