import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useWizardStore } from '@/lib/store'

export function TriageCardScreen() {
  const { triageIndex, mergedAccounts, decideTriage, back } = useWizardStore()
  const account = mergedAccounts[triageIndex]
  const total = mergedAccounts.length

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'k' || e.key === 'K') decideTriage('keep')
      else if (e.key === 'd' || e.key === 'D') decideTriage('delete')
      else if (e.key === 's' || e.key === 'S') decideTriage('skip')
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [decideTriage])

  if (!account) return null

  return (
    <div className="flex flex-col h-full gap-6 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Review accounts</h2>
        <span className="text-xs text-muted-foreground">
          {triageIndex + 1} of {total}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{account.normalizedDomain || account.title || 'Unknown'}</CardTitle>
          <CardDescription>{account.username || '(no username)'}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Password hidden</p>
          {account.sources.length > 0 && (
            <p className="text-xs text-muted-foreground">Sources: {account.sources.join(', ')}</p>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={() => decideTriage('keep')}>Keep (K)</Button>
        <Button variant="destructive" onClick={() => decideTriage('delete')}>Delete (D)</Button>
        <Button variant="outline" onClick={() => decideTriage('skip')}>Skip (S)</Button>
      </div>

      <div className="mt-auto">
        <Button variant="outline" onClick={back}>Back</Button>
      </div>
    </div>
  )
}
