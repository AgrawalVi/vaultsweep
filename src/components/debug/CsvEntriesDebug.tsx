import { useState, useEffect } from "react"
import { listen } from "@tauri-apps/api/event"
import { emit } from "@tauri-apps/api/event"
import { SearchIcon } from "lucide-react"

import type { RawEntry } from "@/types/parser"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

function extractDomain(url: string | null): string {
  if (!url) return ""
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`)
    return u.hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

export function CsvEntriesDebug() {
  const [entries, setEntries] = useState<RawEntry[]>([])
  const [search, setSearch] = useState("")

  useEffect(() => {
    // Request entries from the main window
    emit("debug:request-raw-entries", null).catch(() => {})

    const unlisten = listen<{ entries: RawEntry[] }>(
      "debug:raw-entries-updated",
      (event) => {
        setEntries(event.payload.entries)
      }
    )

    return () => {
      unlisten.then((u) => u())
    }
  }, [])

  const filtered = entries.filter((e) => {
    if (!search) return true
    const domain = extractDomain(e.url)
    return domain.toLowerCase().includes(search.toLowerCase())
  })

  return (
    <div className="flex flex-col gap-4 p-4 h-screen">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold">CSV Entries</h1>
        <Badge variant="secondary">{filtered.length} / {entries.length}</Badge>
      </div>

      <div className="relative">
        <SearchIcon
          data-icon="inline-start"
          className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none"
        />
        <Input
          className="pl-8"
          placeholder="Filter by domain…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Password</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>OTP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground py-8"
                >
                  {entries.length === 0
                    ? "No entries loaded. Parse CSVs in the main window first."
                    : "No entries match the search."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((entry, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{entry.source}</TableCell>
                  <TableCell>{extractDomain(entry.url)}</TableCell>
                  <TableCell className="max-w-48 truncate text-muted-foreground">
                    {entry.url ?? "—"}
                  </TableCell>
                  <TableCell>{entry.username ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">••••</TableCell>
                  <TableCell>{entry.title ?? "—"}</TableCell>
                  <TableCell>
                    {entry.notes ? (
                      <Badge variant="secondary">yes</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {entry.otpAuth ? (
                      <Badge variant="secondary">yes</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
