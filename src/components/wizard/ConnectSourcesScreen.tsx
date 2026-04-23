import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardFooter, CardContent } from '@/components/ui/card'
import { useWizardStore, SOURCE_FORMAT } from '@/lib/store'
import { pickCsvFile } from '@/lib/tauri'

const SOURCES = [
  { id: 'icloud', label: 'iCloud Keychain', description: 'Export from Passwords app: File → Export All Passwords' },
  { id: 'chrome', label: 'Chrome / Brave / Edge', description: 'Export from chrome://password-manager/settings → Download' },
  { id: 'arc', label: 'Arc', description: 'Export from arc://password-manager/settings → Download' },
]

export function ConnectSourcesScreen() {
  const { sourceCounts, sourceErrors, sourcePending, addSource, advance, back } = useWizardStore()
  const canContinue = Object.values(sourceCounts).some(n => n > 0)

  async function handlePick(id: string, label: string) {
    const path = await pickCsvFile()
    if (!path) return
    await addSource(id, { format: SOURCE_FORMAT[id], name: label, path })
  }

  return (
    <div className="flex flex-col h-full gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Connect your password sources</h2>
        <p className="text-muted-foreground text-xs">Pick the exported CSV from each browser or keychain you want to import.</p>
      </div>

      <div className="flex flex-col gap-3">
        {SOURCES.map(source => {
          const count = sourceCounts[source.id]
          const error = sourceErrors[source.id]
          const pending = sourcePending[source.id]
          const connected = count !== undefined

          return (
            <Card key={source.id}>
              <CardHeader>
                <CardTitle>{source.label}</CardTitle>
                <CardDescription>{source.description}</CardDescription>
              </CardHeader>
              {(connected || error) && (
                <CardContent className="pt-0">
                  {error
                    ? <p className="text-xs text-destructive">{error}</p>
                    : <p className="text-xs text-muted-foreground">{count} accounts found</p>
                  }
                </CardContent>
              )}
              <CardFooter className="justify-end">
                <Button
                  variant={connected && !error ? 'outline' : 'default'}
                  disabled={pending}
                  onClick={() => handlePick(source.id, source.label)}
                >
                  {pending ? 'Reading…' : connected ? 'Change file' : 'Pick file…'}
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>

      <div className="flex gap-2 mt-auto">
        <Button variant="outline" onClick={back}>Back</Button>
        <Button disabled={!canContinue} onClick={advance}>Continue</Button>
      </div>
    </div>
  )
}
