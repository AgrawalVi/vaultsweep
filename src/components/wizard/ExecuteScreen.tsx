import { Button } from '@/components/ui/button'
import { useWizardStore } from '@/lib/store'

export function ExecuteScreen() {
  const advance = useWizardStore(s => s.advance)
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <h1 className="text-2xl font-semibold">Execute</h1>
      <Button onClick={advance}>Next →</Button>
    </div>
  )
}
