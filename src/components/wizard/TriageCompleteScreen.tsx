import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useWizardStore } from '@/lib/store'

export function TriageCompleteScreen() {
  const { triageDecisions, back } = useWizardStore()

  const stats = [
    { label: 'Keep', value: triageDecisions.keep },
    { label: 'Delete', value: triageDecisions.delete },
    { label: 'Skip', value: triageDecisions.skip },
  ]

  return (
    <div className="flex flex-col h-full gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Review complete</h2>
        <p className="text-muted-foreground text-xs">Here's what you decided.</p>
      </div>

      <div className="flex flex-col gap-3">
        {stats.map(stat => (
          <Card key={stat.label}>
            <CardContent className="flex items-center justify-between py-3">
              <span className="text-sm text-muted-foreground">{stat.label}</span>
              <span className="text-sm font-semibold">{stat.value}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-2 mt-auto">
        <Button variant="outline" onClick={back}>Back</Button>
        <Button variant="outline" disabled>Continue to Phase 2</Button>
      </div>
    </div>
  )
}
