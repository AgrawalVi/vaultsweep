import { useState, useEffect, useMemo } from "react"
import { listen, emit } from "@tauri-apps/api/event"
import { CheckIcon, PlusCircleIcon, SearchIcon } from "lucide-react"

import type { MergedAccount, RawEntry } from "@/types/parser"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"

type View = "raw" | "merged" | "conflicts"
type MergeStatus = "conflict" | "subdomain-interesting" | "subdomain-boring" | "clean-merge" | "single"

const MERGE_STATUS_OPTIONS: { value: MergeStatus; label: string }[] = [
  { value: "conflict", label: "Conflict" },
  { value: "subdomain-interesting", label: "Subdomain (interesting)" },
  { value: "subdomain-boring", label: "Subdomain (boring)" },
  { value: "clean-merge", label: "Clean merge" },
  { value: "single", label: "Single" },
]

function mergeStatus(a: MergedAccount): MergeStatus {
  if (a.hasConflict) return "conflict"
  if (a.isSubdomainMerge && a.subdomainIsInteresting) return "subdomain-interesting"
  if (a.isSubdomainMerge) return "subdomain-boring"
  if (a.sources.length > 1) return "clean-merge"
  return "single"
}

const STATUS_BADGE: Record<MergeStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  "conflict": { label: "conflict", variant: "destructive" },
  "subdomain-interesting": { label: "subdomain (interesting)", variant: "default" },
  "subdomain-boring": { label: "subdomain (boring)", variant: "secondary" },
  "clean-merge": { label: "clean merge", variant: "secondary" },
  "single": { label: "single", variant: "outline" },
}

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
  const [accounts, setAccounts] = useState<MergedAccount[]>([])
  const [search, setSearch] = useState("")
  const [view, setView] = useState<View>("raw")
  const [statusFilter, setStatusFilter] = useState<Set<MergeStatus>>(new Set())

  useEffect(() => {
    emit("debug:request-raw-entries", null).catch(() => {})
    emit("debug:request-merged-accounts", null).catch(() => {})

    const unlistenEntries = listen<{ entries: RawEntry[] }>(
      "debug:raw-entries-updated",
      (event) => setEntries(event.payload.entries),
    )
    const unlistenAccounts = listen<{ accounts: MergedAccount[] }>(
      "debug:merged-accounts-updated",
      (event) => setAccounts(event.payload.accounts),
    )

    return () => {
      unlistenEntries.then((u) => u())
      unlistenAccounts.then((u) => u())
    }
  }, [])

  const filteredEntries = useMemo(() => {
    if (!search) return entries
    const q = search.toLowerCase()
    return entries.filter((e) => extractDomain(e.url).toLowerCase().includes(q))
  }, [entries, search])

  const filteredAccounts = useMemo(() => {
    const q = search.toLowerCase()
    return accounts.filter((a) => {
      if (q) {
        const matches =
          a.normalizedDomain.toLowerCase().includes(q) ||
          a.username.toLowerCase().includes(q)
        if (!matches) return false
      }
      if (statusFilter.size > 0 && !statusFilter.has(mergeStatus(a))) return false
      return true
    })
  }, [accounts, search, statusFilter])

  const statusCounts = useMemo(() => {
    const counts: Record<MergeStatus, number> = {
      "conflict": 0,
      "subdomain-interesting": 0,
      "subdomain-boring": 0,
      "clean-merge": 0,
      "single": 0,
    }
    for (const a of accounts) counts[mergeStatus(a)]++
    return counts
  }, [accounts])

  const conflicts = useMemo(
    () => filteredAccounts.filter((a) => a.hasConflict),
    [filteredAccounts],
  )

  const total = view === "raw" ? entries.length : view === "merged" ? accounts.length : accounts.filter(a => a.hasConflict).length
  const shown = view === "raw" ? filteredEntries.length : view === "merged" ? filteredAccounts.length : conflicts.length

  return (
    <div className="flex flex-col gap-4 p-4 h-screen">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold">Vaultsweep debug</h1>
        <Select value={view} onValueChange={(v) => setView(v as View)}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="raw">Raw CSV entries</SelectItem>
            <SelectItem value="merged">Merged accounts</SelectItem>
            <SelectItem value="conflicts">Merge conflicts</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="secondary">{shown} / {total}</Badge>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon
            data-icon="inline-start"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none"
          />
          <Input
            className="pl-8"
            placeholder={view === "raw" ? "Filter by domain…" : "Filter by domain or username…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {view === "merged" && (
          <FacetedFilter
            title="Status"
            options={MERGE_STATUS_OPTIONS}
            counts={statusCounts}
            selected={statusFilter}
            onChange={setStatusFilter}
          />
        )}
      </div>

      <div className="flex-1 overflow-auto rounded-md border">
        {view === "raw" && <RawView entries={filteredEntries} total={entries.length} />}
        {view === "merged" && <MergedView accounts={filteredAccounts} total={accounts.length} />}
        {view === "conflicts" && <ConflictsView conflicts={conflicts} total={accounts.filter(a => a.hasConflict).length} />}
      </div>
    </div>
  )
}

function RawView({ entries, total }: { entries: RawEntry[]; total: number }) {
  return (
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
        {entries.length === 0 ? (
          <TableRow>
            <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
              {total === 0 ? "No entries loaded. Parse CSVs in the main window first." : "No entries match the search."}
            </TableCell>
          </TableRow>
        ) : (
          entries.map((entry, i) => (
            <TableRow key={i}>
              <TableCell className="font-medium">{entry.source}</TableCell>
              <TableCell>{extractDomain(entry.url)}</TableCell>
              <TableCell className="max-w-48 truncate text-muted-foreground">{entry.url ?? "—"}</TableCell>
              <TableCell>{entry.username ?? "—"}</TableCell>
              <TableCell className="text-muted-foreground">••••</TableCell>
              <TableCell>{entry.title ?? "—"}</TableCell>
              <TableCell>
                {entry.notes ? <Badge variant="secondary">yes</Badge> : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell>
                {entry.otpAuth ? <Badge variant="secondary">yes</Badge> : <span className="text-muted-foreground">—</span>}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

function MergedView({ accounts, total }: { accounts: MergedAccount[]; total: number }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Domain</TableHead>
          <TableHead>Username</TableHead>
          <TableHead>Classification</TableHead>
          <TableHead>Sources</TableHead>
          <TableHead>URLs</TableHead>
          <TableHead>Passwords</TableHead>
          <TableHead>OTP</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
              {total === 0 ? "No merged accounts yet. Advance past Import Summary in the main window." : "No accounts match the search."}
            </TableCell>
          </TableRow>
        ) : (
          accounts.map((a, i) => {
            const cls = STATUS_BADGE[mergeStatus(a)]
            return (
              <TableRow key={i}>
                <TableCell className="font-medium">{a.normalizedDomain}</TableCell>
                <TableCell>{a.username || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell><Badge variant={cls.variant}>{cls.label}</Badge></TableCell>
                <TableCell className="text-muted-foreground">{a.sources.join(", ")}</TableCell>
                <TableCell className="max-w-64 truncate text-muted-foreground" title={a.allUrls.join("\n")}>
                  {a.allUrls.length} {a.allUrls.length > 0 && <span className="text-xs">({a.allUrls[0]}{a.allUrls.length > 1 ? "…" : ""})</span>}
                </TableCell>
                <TableCell>{a.passwords.length}</TableCell>
                <TableCell>
                  {a.otpAuth ? <Badge variant="secondary">yes</Badge> : <span className="text-muted-foreground">—</span>}
                </TableCell>
              </TableRow>
            )
          })
        )}
      </TableBody>
    </Table>
  )
}

interface FacetedFilterProps<T extends string> {
  title: string
  options: { value: T; label: string }[]
  counts: Record<T, number>
  selected: Set<T>
  onChange: (next: Set<T>) => void
}

function FacetedFilter<T extends string>({ title, options, counts, selected, onChange }: FacetedFilterProps<T>) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="h-9 border-dashed" />}>
        <PlusCircleIcon data-icon="inline-start" />
        {title}
        {selected.size > 0 && (
          <>
            <Separator orientation="vertical" className="mx-1 h-4" />
            <Badge variant="secondary" className="rounded-sm px-1 font-normal lg:hidden">
              {selected.size}
            </Badge>
            <div className="hidden gap-1 lg:flex">
              {selected.size > 2 ? (
                <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                  {selected.size} selected
                </Badge>
              ) : (
                options
                  .filter((o) => selected.has(o.value))
                  .map((o) => (
                    <Badge key={o.value} variant="secondary" className="rounded-sm px-1 font-normal">
                      {o.label}
                    </Badge>
                  ))
              )}
            </div>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selected.has(option.value)
                return (
                  <CommandItem
                    key={option.value}
                    onSelect={() => {
                      const next = new Set(selected)
                      if (isSelected) next.delete(option.value)
                      else next.add(option.value)
                      onChange(next)
                    }}
                  >
                    <div
                      className={cn(
                        "mr-2 flex size-4 items-center justify-center rounded-sm border border-primary",
                        isSelected ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible",
                      )}
                    >
                      <CheckIcon className="size-3.5" />
                    </div>
                    <span>{option.label}</span>
                    <span className="ml-auto flex size-4 items-center justify-center font-mono text-xs text-muted-foreground">
                      {counts[option.value]}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {selected.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => onChange(new Set())} className="justify-center text-center">
                    Clear filters
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ConflictsView({ conflicts, total }: { conflicts: MergedAccount[]; total: number }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Domain</TableHead>
          <TableHead>Username</TableHead>
          <TableHead>URLs</TableHead>
          <TableHead>Competing passwords</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {conflicts.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
              {total === 0 ? "No conflicts detected." : "No conflicts match the search."}
            </TableCell>
          </TableRow>
        ) : (
          conflicts.map((a, i) => (
            <TableRow key={i}>
              <TableCell className="font-medium">{a.normalizedDomain}</TableCell>
              <TableCell>{a.username || <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="max-w-64 text-xs text-muted-foreground">
                {a.allUrls.map((u, j) => <div key={j} className="truncate">{u}</div>)}
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  {a.passwords.map((p, j) => (
                    <div key={j} className="flex items-center gap-2 text-xs">
                      <Badge variant="outline">{p.source}</Badge>
                      <code className="font-mono text-muted-foreground">••••••••</code>
                      <span className="text-muted-foreground">(len {p.password.length})</span>
                    </div>
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}
