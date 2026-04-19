import { Button } from '@/components/ui/button'
import { useWizardStore } from '@/lib/store'

export function DoneScreen() {
  const reset = useWizardStore(s => s.reset)
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <h1 className="text-2xl font-semibold">Done</h1>
      <Button variant="outline" onClick={reset}>Start over</Button>
    </div>
  )
}
