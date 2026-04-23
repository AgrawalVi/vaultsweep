import { useEffect, useState } from 'react'
import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useWizardStore, type UploadedSource } from '@/lib/store'
import { pickCsvFiles } from '@/lib/tauri'
import type { BrowserFormat } from '@/types/parser'

interface Category {
  format: BrowserFormat
  label: string
  description: string
  examples: string
}

const CATEGORIES: Category[] = [
  {
    format: 'chromium',
    label: 'Chrome-based browsers',
    description: 'Chrome, Brave, Edge, Arc, Opera, Vivaldi',
    examples: 'Export from chrome://password-manager/settings → Download',
  },
  {
    format: 'firefox',
    label: 'Firefox-based browsers',
    description: 'Firefox, Waterfox, LibreWolf, Zen',
    examples: 'Export from about:logins → ⋯ → Export Logins',
  },
  {
    format: 'icloud',
    label: 'Safari / iCloud Keychain',
    description: 'Apple Passwords app, iCloud Keychain',
    examples: 'Passwords app → File → Export All Passwords',
  },
]

function fileNameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}

export function ConnectSourcesScreen() {
  const { uploads, addUpload, advance, back } = useWizardStore()
  const canContinue = uploads.some(u => !u.pending && !u.error && u.entries.length > 0)

  async function handleAdd(category: BrowserFormat) {
    const paths = await pickCsvFiles()
    for (const p of paths) {
      await addUpload(category, p)
    }
  }

  return (
    <div className="flex flex-col h-full gap-6 p-6 overflow-auto">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Connect your password sources</h2>
        <p className="text-muted-foreground text-xs">
          Add exported CSVs from each browser or keychain. You can add more than one file per category
          (e.g. multiple Chrome profiles) and rename them so they're easy to recognise later.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {CATEGORIES.map(category => {
          const categoryUploads = uploads.filter(u => u.category === category.format)
          return (
            <Card key={category.format}>
              <CardHeader>
                <CardTitle>{category.label}</CardTitle>
                <CardDescription>{category.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground">{category.examples}</p>

                {categoryUploads.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {categoryUploads.map(upload => (
                      <UploadRow key={upload.id} upload={upload} />
                    ))}
                  </div>
                )}

                <div>
                  <Button variant="outline" size="sm" onClick={() => handleAdd(category.format)}>
                    {categoryUploads.length === 0 ? 'Add file…' : 'Add another file…'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="flex gap-2 mt-auto pt-2">
        <Button variant="outline" onClick={back}>Back</Button>
        <Button disabled={!canContinue} onClick={advance}>Continue</Button>
      </div>
    </div>
  )
}

function UploadRow({ upload }: { upload: UploadedSource }) {
  const { renameUpload, removeUpload } = useWizardStore()
  const [localName, setLocalName] = useState(upload.name)

  useEffect(() => {
    setLocalName(upload.name)
  }, [upload.name])

  function commit() {
    const trimmed = localName.trim()
    if (!trimmed) {
      setLocalName(upload.name)
      return
    }
    if (trimmed !== upload.name) renameUpload(upload.id, trimmed)
  }

  const status = upload.pending
    ? 'Reading…'
    : upload.error
      ? upload.error
      : `${upload.entries.length} accounts`

  return (
    <div className="flex items-start gap-2 border border-border p-2">
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <Input
          value={localName}
          onChange={e => setLocalName(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              setLocalName(upload.name)
              e.currentTarget.blur()
            }
          }}
          disabled={upload.pending}
          aria-label="Source name"
        />
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="truncate" title={upload.path}>{fileNameOf(upload.path)}</span>
          <span className={upload.error ? 'text-destructive shrink-0' : 'shrink-0'}>{status}</span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Remove file"
        onClick={() => removeUpload(upload.id)}
        disabled={upload.pending}
      >
        <XIcon />
      </Button>
    </div>
  )
}
