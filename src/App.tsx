import './App.css'
import { AppShell } from './components/shell/AppShell'
import { WelcomeScreen } from './components/wizard/WelcomeScreen'
import { ImportScreen } from './components/wizard/ImportScreen'
import { TriageScreen } from './components/wizard/TriageScreen'
import { ExecuteScreen } from './components/wizard/ExecuteScreen'
import { DoneScreen } from './components/wizard/DoneScreen'
import { useWizardStore, type WizardStep } from './lib/store'

const screens: Record<WizardStep, React.ReactNode> = {
  welcome: <WelcomeScreen />,
  import: <ImportScreen />,
  triage: <TriageScreen />,
  execute: <ExecuteScreen />,
  done: <DoneScreen />,
}

function App() {
  const step = useWizardStore(s => s.step)
  return <AppShell>{screens[step]}</AppShell>
}

export default App
