import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { useWizardStore, FAKE_CONFLICT_COUNT } from '@/lib/store'

const CONFLICTS = [
  { domain: 'github.com', username: 'you@example.com', passwordA: 'hunter2', passwordB: 'correct-horse-battery' },
  { domain: 'notion.so', username: 'you@example.com', passwordA: 'abc123!', passwordB: 'Xk9#mP2$' },
  { domain: 'figma.com', username: 'you@example.com', passwordA: 'figmapass', passwordB: 'F1gm@2024' },
]

export function MergeConflictScreen() {
  const { mergeConflictIndex, pickMergeCandidate, back } = useWizardStore()
  const conflict = CONFLICTS[Math.min(mergeConflictIndex, CONFLICTS.length - 1)]

  return (
    <div className="flex flex-col h-full gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">
          Merge conflict {mergeConflictIndex + 1} of {FAKE_CONFLICT_COUNT}
        </h2>
        <p className="text-muted-foreground text-xs">
          Two sources have different passwords for the same account. Pick one to keep.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">{conflict.domain} · {conflict.username}</p>
      </div>

      <div className="flex gap-3">
        <Card className="flex-1">
          <CardHeader>
            <CardTitle>Option A</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs font-mono">{conflict.passwordA}</p>
          </CardContent>
          <CardFooter className="justify-end">
            <Button onClick={pickMergeCandidate}>Use this</Button>
          </CardFooter>
        </Card>

        <Card className="flex-1">
          <CardHeader>
            <CardTitle>Option B</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs font-mono">{conflict.passwordB}</p>
          </CardContent>
          <CardFooter className="justify-end">
            <Button onClick={pickMergeCandidate}>Use this</Button>
          </CardFooter>
        </Card>
      </div>

      <div className="mt-auto">
        <Button variant="outline" onClick={back}>Back</Button>
      </div>
    </div>
  )
}
