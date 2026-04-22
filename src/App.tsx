import './App.css'
import { AppShell } from './components/shell/AppShell'
import { WelcomeScreen } from './components/wizard/WelcomeScreen'
import { ConnectSourcesScreen } from './components/wizard/ConnectSourcesScreen'
import { ImportSummaryScreen } from './components/wizard/ImportSummaryScreen'
import { MergeConflictScreen } from './components/wizard/MergeConflictScreen'
import { TriageCardScreen } from './components/wizard/TriageCardScreen'
import { TriageCompleteScreen } from './components/wizard/TriageCompleteScreen'
import { useWizardStore, type WizardStep } from './lib/store'

const screens: Record<WizardStep, React.ReactNode> = {
  'welcome': <WelcomeScreen />,
  'connect-sources': <ConnectSourcesScreen />,
  'import-summary': <ImportSummaryScreen />,
  'merge-conflict': <MergeConflictScreen />,
  'triage-card': <TriageCardScreen />,
  'triage-complete': <TriageCompleteScreen />,
}

function App() {
  const step = useWizardStore(s => s.step)
  return <AppShell>{screens[step]}</AppShell>
}

export default App
