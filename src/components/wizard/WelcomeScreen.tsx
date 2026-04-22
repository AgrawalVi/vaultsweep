import { Button } from '@/components/ui/button'
import { useWizardStore } from '@/lib/store'

export function WelcomeScreen() {
  const advance = useWizardStore(s => s.advance)
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-3xl font-semibold">Vaultsweep</h1>
        <p className="text-muted-foreground text-sm">Move your passwords to 1Password in one sitting.</p>
      </div>
      <Button onClick={advance}>Get started</Button>
    </div>
  )
}
