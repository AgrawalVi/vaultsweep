import { useEffect, useMemo, useState } from 'react'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useWizardStore, type ConflictResolution } from '@/lib/store'
import type { PasswordEntry } from '@/types/parser'

type Action = 'combine' | 'separate' | 'discard'

function maskedDots(password: string): string {
  const len = Math.min(password.length, 24)
  return '•'.repeat(Math.max(len, 1))
}

function subdomainLabel(url: string | null, domain: string): string {
  if (!url) return domain
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === domain ? domain : host
  } catch {
    return url
  }
}

export function MergeConflictScreen() {
  const { rawMergedAccounts, mergeConflictIndex, resolveConflict, back } = useWizardStore()
  const conflicts = useMemo(
    () => rawMergedAccounts.map((a, i) => ({ a, i })).filter(({ a }) => a.hasConflict),
    [rawMergedAccounts],
  )
  const current = conflicts[mergeConflictIndex]

  const [action, setAction] = useState<Action>('combine')
  const [chosenPasswordIdx, setChosenPasswordIdx] = useState(0)
  const [showPasswords, setShowPasswords] = useState(false)

  // Reset per-conflict local state whenever the visible conflict changes.
  // Done during render rather than in an effect so the new conflict never
  // renders with the previous one's choice.
  const [shownConflict, setShownConflict] = useState(current?.i)
  if (current?.i !== shownConflict) {
    setShownConflict(current?.i)
    setAction('combine')
    setChosenPasswordIdx(0)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current) return
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === '1') setAction('combine')
      else if (e.key === '2') setAction('separate')
      else if (e.key === '3') setAction('discard')
      else if (e.key === 'Enter') {
        e.preventDefault()
        commit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, chosenPasswordIdx, current?.i])

  if (!current) return null
  const { a: account, i: idx } = current

  function commit() {
    let resolution: ConflictResolution
    if (action === 'combine') resolution = { kind: 'combine', passwordIdx: chosenPasswordIdx }
    else if (action === 'separate') resolution = { kind: 'separate' }
    else resolution = { kind: 'discard' }
    resolveConflict(idx, resolution)
  }

  return (
    <div className="flex flex-col h-full gap-6 p-6 overflow-auto">
      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">
          Conflict {mergeConflictIndex + 1} of {conflicts.length}
        </p>
        <h2 className="text-lg font-semibold">
          {account.normalizedDomain}
        </h2>
        <p className="text-sm text-muted-foreground">{account.username || '(no username)'}</p>
        <p className="text-xs text-muted-foreground mt-1">
          Same account, different passwords across sources. Decide how to handle it.
        </p>
      </div>

      <div className="flex items-center justify-end">
        <Button variant="ghost" size="sm" onClick={() => setShowPasswords(v => !v)}>
          {showPasswords ? <EyeOffIcon data-icon="inline-start" /> : <EyeIcon data-icon="inline-start" />}
          {showPasswords ? 'Hide' : 'Show'} passwords
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {account.passwords.map((entry, i) => (
          <CandidateCard
            key={i}
            entry={entry}
            domain={account.normalizedDomain}
            reveal={showPasswords}
            selected={action === 'combine' && chosenPasswordIdx === i}
            selectable={action === 'combine'}
            onSelect={() => setChosenPasswordIdx(i)}
          />
        ))}
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">What do you want to do?</p>
        <RadioGroup value={action} onValueChange={v => setAction(v as Action)} className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <RadioGroupItem id="opt-combine" value="combine" className="mt-0.5" />
            <div className="flex flex-col">
              <Label htmlFor="opt-combine">Combine into one (1)</Label>
              <span className="text-xs text-muted-foreground">
                Keep one account. Pick which password wins above.
              </span>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <RadioGroupItem id="opt-separate" value="separate" className="mt-0.5" />
            <div className="flex flex-col">
              <Label htmlFor="opt-separate">Keep them separate (2)</Label>
              <span className="text-xs text-muted-foreground">
                Treat each candidate as its own account. Subdomain URLs are preserved.
              </span>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <RadioGroupItem id="opt-discard" value="discard" className="mt-0.5" />
            <div className="flex flex-col">
              <Label htmlFor="opt-discard">Discard all (3)</Label>
              <span className="text-xs text-muted-foreground">
                Mark every candidate for deletion. You'll confirm before anything is removed.
              </span>
            </div>
          </div>
        </RadioGroup>
      </div>

      <div className="flex gap-2 mt-auto pt-4">
        <Button variant="outline" onClick={back}>Back</Button>
        <Button onClick={commit} className="ml-auto">
          {action === 'combine' && 'Combine'}
          {action === 'separate' && 'Keep separate'}
          {action === 'discard' && 'Discard all'}
        </Button>
      </div>
    </div>
  )
}

function CandidateCard({
  entry,
  domain,
  reveal,
  selected,
  selectable,
  onSelect,
}: {
  entry: PasswordEntry
  domain: string
  reveal: boolean
  selected: boolean
  selectable: boolean
  onSelect: () => void
}) {
  return (
    <Card
      className={selected ? 'ring-2 ring-foreground/40' : ''}
      onClick={selectable ? onSelect : undefined}
      data-selected={selected}
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      onKeyDown={e => {
        if (!selectable) return
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onSelect()
        }
      }}
      style={selectable ? { cursor: 'pointer' } : undefined}
    >
      <CardHeader>
        <CardTitle className="text-sm">From {entry.source}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Saved under</span>
          <span className="text-xs break-all">{subdomainLabel(entry.url, domain)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Password</span>
          <span className="font-mono text-sm break-all">
            {reveal ? entry.password : maskedDots(entry.password)}
          </span>
          <span className="text-[11px] text-muted-foreground">{entry.password.length} characters</span>
        </div>
      </CardContent>
    </Card>
  )
}
