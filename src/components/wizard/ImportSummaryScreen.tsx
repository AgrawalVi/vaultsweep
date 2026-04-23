import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useWizardStore } from '@/lib/store'

export function ImportSummaryScreen() {
  const { rawEntries, mergedAccounts, mergePending, mergeError, runMerge, advance, back } = useWizardStore()

  useEffect(() => {
    runMerge()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cleanMergeCount = mergedAccounts.filter(
    a => !a.isSubdomainMerge && !a.hasConflict && a.sources.length > 1,
  ).length
  const subdomainReviewCount = mergedAccounts.filter(
    a => a.isSubdomainMerge && a.subdomainIsInteresting,
  ).length
  const conflictCount = mergedAccounts.filter(a => a.hasConflict).length

  const stats = [
    { label: 'Accounts found', value: rawEntries.length },
    { label: 'Clean merges collapsed', value: cleanMergeCount },
    { label: 'Subdomain merges to review', value: subdomainReviewCount },
    { label: 'Conflicts to resolve', value: conflictCount },
  ]

  return (
    <div className="flex flex-col h-full gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Import summary</h2>
        <p className="text-muted-foreground text-xs">Here's what we found across your sources.</p>
      </div>

      {mergePending && (
        <p className="text-sm text-muted-foreground">Merging accounts…</p>
      )}

      {mergeError && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-destructive">{mergeError}</p>
          <Button variant="outline" size="sm" onClick={runMerge}>Retry</Button>
        </div>
      )}

      {!mergePending && !mergeError && (
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
      )}

      <div className="flex gap-2 mt-auto">
        <Button variant="outline" onClick={back}>Back</Button>
        <Button disabled={mergePending || !!mergeError} onClick={advance}>
          {conflictCount > 0 ? `Resolve ${conflictCount} conflict${conflictCount === 1 ? '' : 's'}` : 'Start reviewing'}
        </Button>
      </div>
    </div>
  )
}
