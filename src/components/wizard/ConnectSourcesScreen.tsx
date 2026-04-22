import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { useWizardStore } from '@/lib/store'

const SOURCES = [
  { id: 'icloud', label: 'iCloud Keychain', description: 'Passwords saved in Safari and iCloud' },
  { id: 'chrome', label: 'Chrome', description: 'Passwords saved in Google Chrome' },
  { id: 'arc', label: 'Arc', description: 'Passwords saved in the Arc browser' },
]

export function ConnectSourcesScreen() {
  const { connectedSources, fakeAccountsFound, connectSource, advance, back } = useWizardStore()
  const canContinue = connectedSources.length >= 1

  return (
    <div className="flex flex-col h-full gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Connect your password sources</h2>
        <p className="text-muted-foreground text-xs">Select the browsers and keychains you want to import from.</p>
      </div>

      <div className="flex flex-col gap-3">
        {SOURCES.map(source => {
          const connected = connectedSources.includes(source.id)
          return (
            <Card key={source.id}>
              <CardHeader>
                <CardTitle>{source.label}</CardTitle>
                <CardDescription>{source.description}</CardDescription>
              </CardHeader>
              <CardFooter className="justify-end">
                <Button
                  variant={connected ? 'outline' : 'default'}
                  disabled={connected}
                  onClick={() => connectSource(source.id)}
                >
                  {connected ? 'Connected ✓' : 'Connect'}
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>

      {fakeAccountsFound > 0 && (
        <p className="text-sm text-muted-foreground">{fakeAccountsFound} accounts found</p>
      )}

      <div className="flex gap-2 mt-auto">
        <Button variant="outline" onClick={back}>Back</Button>
        <Button disabled={!canContinue} onClick={advance}>Continue</Button>
      </div>
    </div>
  )
}
