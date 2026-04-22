import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useWizardStore, FAKE_TRIAGE_COUNT } from '@/lib/store'

const FAKE_ACCOUNTS = [
  { domain: 'twitter.com', username: 'you@example.com' },
  { domain: 'linkedin.com', username: 'you@example.com' },
  { domain: 'netflix.com', username: 'you@example.com' },
  { domain: 'spotify.com', username: 'you@example.com' },
  { domain: 'dropbox.com', username: 'you@example.com' },
  { domain: 'amazon.com', username: 'you@example.com' },
  { domain: 'reddit.com', username: 'you@example.com' },
  { domain: 'slack.com', username: 'you@example.com' },
]

export function TriageCardScreen() {
  const { triageIndex, decideTriage, back } = useWizardStore()
  const account = FAKE_ACCOUNTS[Math.min(triageIndex, FAKE_ACCOUNTS.length - 1)]

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'k' || e.key === 'K') decideTriage('keep')
      else if (e.key === 'd' || e.key === 'D') decideTriage('delete')
      else if (e.key === 's' || e.key === 'S') decideTriage('skip')
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [decideTriage])

  return (
    <div className="flex flex-col h-full gap-6 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Review accounts</h2>
        <span className="text-xs text-muted-foreground">
          {triageIndex + 1} of {FAKE_TRIAGE_COUNT}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{account.domain}</CardTitle>
          <CardDescription>{account.username}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Password hidden</p>
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
