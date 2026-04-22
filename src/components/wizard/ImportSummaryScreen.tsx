import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useWizardStore, FAKE_DUPLICATES, FAKE_CONFLICT_COUNT } from '@/lib/store'

export function ImportSummaryScreen() {
  const { fakeAccountsFound, advance, back } = useWizardStore()

  const stats = [
    { label: 'Accounts found', value: fakeAccountsFound },
    { label: 'Likely duplicates', value: FAKE_DUPLICATES },
    { label: 'Merge conflicts', value: FAKE_CONFLICT_COUNT },
  ]

  return (
    <div className="flex flex-col h-full gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Import summary</h2>
        <p className="text-muted-foreground text-xs">Here's what we found across your sources.</p>
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
        <Button onClick={advance}>Start reviewing</Button>
      </div>
    </div>
  )
}
