import { useState } from 'react'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { useWizardStore } from '@/lib/store'

export function MergeConflictScreen() {
  const { mergedAccounts, mergeConflictIndex, resolveConflict, back } = useWizardStore()
  const [showPasswords, setShowPasswords] = useState(false)

  const conflicts = mergedAccounts
    .map((a, i) => ({ account: a, idx: i }))
    .filter(({ account }) => account.hasConflict)

  const current = conflicts[mergeConflictIndex]

  if (!current) return null

  const { account, idx } = current

  return (
    <div className="flex flex-col h-full gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">
          Merge conflict {mergeConflictIndex + 1} of {conflicts.length}
        </h2>
        <p className="text-muted-foreground text-xs">
          Two sources have different passwords for the same account. Pick one to keep.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{account.normalizedDomain} · {account.username}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowPasswords(v => !v)}
        >
          {showPasswords ? (
            <EyeOffIcon data-icon="inline-start" />
          ) : (
            <EyeIcon data-icon="inline-start" />
          )}
          {showPasswords ? 'Hide' : 'Show'} passwords
        </Button>
      </div>

      <div className="flex gap-3 flex-wrap">
        {account.passwords.map((entry, passwordIdx) => (
          <Card key={passwordIdx} className="flex-1 min-w-[140px]">
            <CardHeader>
              <CardTitle className="text-sm">{entry.source}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs font-mono break-all">
                {showPasswords ? entry.password : '••••••••'}
              </p>
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={() => resolveConflict(idx, passwordIdx)}>Use this</Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      <div className="mt-auto">
        <Button variant="outline" onClick={back}>Back</Button>
      </div>
    </div>
  )
}
