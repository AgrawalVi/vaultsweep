import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, EyeIcon, EyeOffIcon, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useWizardStore, type ReviewAccount } from '@/lib/store'

function subdomainChip(url: string, domain: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host === domain) return domain
    const suffix = `.${domain}`
    if (host.endsWith(suffix)) return host.slice(0, -suffix.length)
    return host
  } catch {
    return url
  }
}

function maskedDots(password: string): string {
  const len = Math.min(password.length, 24)
  return '•'.repeat(Math.max(len, 1))
}

export function ReviewMergesScreen() {
  const {
    reviewAccounts,
    reviewShowAll,
    reviewUndoStack,
    initializeReview,
    setReviewShowAll,
    splitReviewAll,
    splitReviewSelected,
    regroupReview,
    undoReview,
    commitReview,
    skipReview,
    back,
  } = useWizardStore()

  useEffect(() => {
    initializeReview()
  }, [initializeReview])

  const interesting = useMemo(
    () => reviewAccounts.filter(r => r.fromInterestingMerge || r.origin === 'split'),
    [reviewAccounts],
  )
  const visible = reviewShowAll ? reviewAccounts : interesting

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [urlSelection, setUrlSelection] = useState<Record<string, Set<string>>>({})
  const [rowSelection, setRowSelection] = useState<Set<string>>(new Set())
  const [showPasswords, setShowPasswords] = useState(false)

  // Empty state: no interesting merges → auto-advance.
  const shouldAutoAdvance = reviewAccounts.length > 0 && interesting.length === 0
  useEffect(() => {
    if (!shouldAutoAdvance) return
    const t = setTimeout(() => skipReview(), 1500)
    return () => clearTimeout(t)
  }, [shouldAutoAdvance, skipReview])

  if (reviewAccounts.length === 0) {
    // Nothing to review at all (no subdomain merges). Should have been skipped by the
    // state machine, but render a harmless fallback just in case.
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">Everything looked clearly separate, nothing to review.</p>
      </div>
    )
  }

  if (shouldAutoAdvance) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">Everything looked clearly separate, nothing to review.</p>
        <p className="text-xs text-muted-foreground">Moving on…</p>
      </div>
    )
  }

  const splitOffRowIds = reviewAccounts.filter(r => r.origin === 'split').map(r => r.id)
  const selectedSplitRows = reviewAccounts.filter(r => rowSelection.has(r.id) && r.origin === 'split')
  const canRegroup =
    selectedSplitRows.length >= 2 &&
    selectedSplitRows.every(r => r.groupKey === selectedSplitRows[0].groupKey)

  const toggleRowSelect = (id: string) => {
    setRowSelection(s => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleUrl = (rowId: string, url: string) => {
    setUrlSelection(prev => {
      const cur = new Set(prev[rowId] ?? [])
      if (cur.has(url)) cur.delete(url)
      else cur.add(url)
      return { ...prev, [rowId]: cur }
    })
  }

  return (
    <div className="flex flex-col h-full gap-4 p-6 overflow-hidden">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Review merged accounts</h2>
          <p className="text-muted-foreground text-xs">
            We combined these automatically. Split any that should stay separate, or move on.
          </p>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setShowPasswords(v => !v)}>
            {showPasswords ? <EyeOffIcon data-icon="inline-start" /> : <EyeIcon data-icon="inline-start" />}
            {showPasswords ? 'Hide' : 'Show'} passwords
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={undoReview}
            disabled={reviewUndoStack.length === 0}
          >
            <Undo2 data-icon="inline-start" />
            Undo
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="show-all-merges"
          checked={reviewShowAll}
          onCheckedChange={v => setReviewShowAll(!!v)}
        />
        <Label htmlFor="show-all-merges" className="text-xs">
          Show all merges ({reviewAccounts.length - interesting.length} hidden)
        </Label>
        {canRegroup && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => {
              regroupReview([...rowSelection])
              setRowSelection(new Set())
            }}
          >
            Regroup selected ({selectedSplitRows.length})
          </Button>
        )}
        {!canRegroup && selectedSplitRows.length >= 2 && (
          <Button size="sm" variant="outline" className="ml-auto" disabled>
            Regroup selected
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2 overflow-auto">
        {visible.length === 0 && (
          <p className="text-xs text-muted-foreground">Nothing to show with the current filter.</p>
        )}
        {visible.map(row => (
          <ReviewRow
            key={row.id}
            row={row}
            expanded={expandedId === row.id}
            onToggleExpand={() => setExpandedId(id => (id === row.id ? null : row.id))}
            selected={rowSelection.has(row.id)}
            onToggleSelect={() => toggleRowSelect(row.id)}
            selectableInRegroup={splitOffRowIds.includes(row.id)}
            revealPassword={showPasswords}
            urlSelected={urlSelection[row.id] ?? new Set()}
            onToggleUrl={(u) => toggleUrl(row.id, u)}
            onSplitAll={() => {
              splitReviewAll(row.id)
              setUrlSelection(p => ({ ...p, [row.id]: new Set() }))
              setExpandedId(null)
            }}
            onSplitSelected={() => {
              const urls = [...(urlSelection[row.id] ?? [])]
              splitReviewSelected(row.id, urls)
              setUrlSelection(p => ({ ...p, [row.id]: new Set() }))
              setExpandedId(null)
            }}
          />
        ))}
      </div>

      <Separator />

      <div className="flex gap-2">
        <Button variant="outline" onClick={back}>Back</Button>
        <Button variant="ghost" onClick={skipReview} className="ml-auto">
          Skip this step
        </Button>
        <Button onClick={commitReview}>Continue</Button>
      </div>
    </div>
  )
}

function ReviewRow({
  row,
  expanded,
  onToggleExpand,
  selected,
  onToggleSelect,
  selectableInRegroup,
  revealPassword,
  urlSelected,
  onToggleUrl,
  onSplitAll,
  onSplitSelected,
}: {
  row: ReviewAccount
  expanded: boolean
  onToggleExpand: () => void
  selected: boolean
  onToggleSelect: () => void
  selectableInRegroup: boolean
  revealPassword: boolean
  urlSelected: Set<string>
  onToggleUrl: (url: string) => void
  onSplitAll: () => void
  onSplitSelected: () => void
}) {
  const pwd = row.passwords[0]
  const isSplitOff = row.origin === 'split'
  const isSingleRow = row.urls.length === 1

  return (
    <Card className={isSplitOff ? 'bg-muted/40' : ''}>
      <CardContent className="flex flex-col gap-3 py-3">
        <div className="flex items-center gap-3">
          {selectableInRegroup && (
            <Checkbox
              checked={selected}
              onCheckedChange={onToggleSelect}
              aria-label="Select for regroup"
            />
          )}
          <button
            type="button"
            onClick={onToggleExpand}
            className="flex-1 text-left flex items-center gap-3"
          >
            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{row.domain}</span>
                {isSplitOff && (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground border px-1.5 py-0.5">
                    split off
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground truncate">{row.username || '(no username)'}</span>
            </div>

            {!isSingleRow && (
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {row.urls.length} combined
              </span>
            )}

            <div className="flex gap-1 max-w-[40%] overflow-hidden">
              {row.urls.slice(0, 3).map(u => (
                <span
                  key={u}
                  className="text-[11px] border px-1.5 py-0.5 truncate max-w-[120px]"
                  title={u}
                >
                  {subdomainChip(u, row.domain)}
                </span>
              ))}
              {row.urls.length > 3 && (
                <span className="text-[11px] text-muted-foreground">+{row.urls.length - 3}</span>
              )}
            </div>
            {!isSingleRow && (
              <ChevronDown
                data-icon="inline-start"
                className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'}
              />
            )}
          </button>
        </div>

        {expanded && !isSingleRow && (
          <div className="flex flex-col gap-2 pl-1">
            <div className="grid gap-2 sm:grid-cols-2">
              {row.urls.map(url => {
                const checked = urlSelected.has(url)
                return (
                  <div
                    key={url}
                    className="flex items-start gap-2 border p-2"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => onToggleUrl(url)}
                      aria-label={`Select ${url}`}
                    />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-xs break-all">{url}</span>
                      <span className="text-[11px] text-muted-foreground">{row.username || '(no username)'}</span>
                      <span className="font-mono text-sm break-all">
                        {revealPassword ? (pwd?.password ?? '') : maskedDots(pwd?.password ?? '')}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={onSplitSelected}
                disabled={(urlSelected?.size ?? 0) === 0 || urlSelected.size === row.urls.length}
              >
                Split selected
              </Button>
              <Button size="sm" variant="outline" onClick={onSplitAll}>
                Split all apart
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
