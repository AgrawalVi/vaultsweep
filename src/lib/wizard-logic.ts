import type { BrowserFormat, MergedAccount, PasswordEntry, RawEntry } from '@/types/parser'

/** Pure wizard logic, extracted from the Zustand store so it can be tested without
 *  a store instance or a DOM. Everything here is a plain function of its arguments —
 *  no `get()`, no `set()`, no `Date.now()`. Store actions in `@/lib/store` are thin
 *  wrappers that feed these and commit the result. */

/** One CSV file the user added under a category. Multiple uploads per category are allowed.
 *  `name` is user-editable and becomes the source label shown in triage and the merger. */
export interface UploadedSource {
  id: string
  category: BrowserFormat
  name: string
  path: string
  entries: RawEntry[]
  error: string | null
  pending: boolean
}

export const CATEGORY_DEFAULT_NAME: Record<BrowserFormat, string> = {
  icloud: 'Safari',
  chromium: 'Chrome',
  firefox: 'Firefox',
}

export type ConflictResolution =
  | { kind: 'combine'; passwordIdx: number }
  | { kind: 'separate' }
  | { kind: 'discard' }

export interface ReviewAccount {
  id: string
  /** `${domain}|${username}` — identifies rows that can be regrouped together. */
  groupKey: string
  domain: string
  username: string
  title: string | null
  notes: string | null
  otpAuth: string | null
  sources: string[]
  passwords: PasswordEntry[]
  /** The subset of URLs represented by this row. For an untouched row this equals
   *  the full `allUrls` of the source merged account. After a split it holds one URL. */
  urls: string[]
  origin: 'original' | 'split'
  /** Only meaningful for originals: was the underlying merge "interesting"? Drives the
   *  default-view filter on the Review Merges screen. */
  fromInterestingMerge: boolean
}

export function suggestUploadName(uploads: UploadedSource[], category: BrowserFormat): string {
  const base = CATEGORY_DEFAULT_NAME[category]
  const existing = uploads.filter(u => u.category === category).length
  return existing === 0 ? base : `${base} (${existing + 1})`
}

export function recomputeRawEntries(uploads: UploadedSource[]): RawEntry[] {
  return uploads.flatMap(u => u.entries.map(e => ({ ...e, source: u.name })))
}

export function accountKey(a: Pick<MergedAccount, 'normalizedDomain' | 'username'>): string {
  return `${a.normalizedDomain}|${a.username}`
}

export function buildReviewAccounts(accounts: MergedAccount[]): ReviewAccount[] {
  return accounts
    .filter(a => a.isSubdomainMerge)
    .map((a, i) => ({
      id: `orig-${i}-${accountKey(a)}`,
      groupKey: accountKey(a),
      domain: a.normalizedDomain,
      username: a.username,
      title: a.title,
      notes: a.notes,
      otpAuth: a.otpAuth,
      sources: [...a.sources],
      passwords: a.passwords.map(p => ({ ...p })),
      urls: [...a.allUrls],
      origin: 'original' as const,
      fromInterestingMerge: a.subdomainIsInteresting,
    }))
}

export function reviewToMergedAccount(r: ReviewAccount): MergedAccount {
  return {
    normalizedDomain: r.domain,
    username: r.username,
    sources: r.sources,
    title: r.title,
    notes: r.notes,
    otpAuth: r.otpAuth,
    passwords: r.passwords,
    hasConflict: false,
    allUrls: r.urls,
    isSubdomainMerge: r.urls.length > 1,
    subdomainIsInteresting: r.urls.length > 1 && r.fromInterestingMerge,
  }
}

/** Apply user's conflict resolutions to produce a flat, conflict-free list plus the
 *  list of accounts the user chose to discard (deferred to Phase 2 deletion review). */
export function applyConflictResolutions(
  accounts: MergedAccount[],
  resolutions: Record<number, ConflictResolution>,
): { resolved: MergedAccount[]; discarded: MergedAccount[] } {
  const resolved: MergedAccount[] = []
  const discarded: MergedAccount[] = []
  accounts.forEach((account, idx) => {
    if (!account.hasConflict) {
      resolved.push(account)
      return
    }
    const r = resolutions[idx] ?? { kind: 'combine' as const, passwordIdx: 0 }
    if (r.kind === 'combine') {
      const chosen = account.passwords[r.passwordIdx] ?? account.passwords[0]
      resolved.push({ ...account, passwords: [chosen], hasConflict: false })
    } else if (r.kind === 'separate') {
      account.passwords.forEach(pw => {
        const url = pw.url ?? null
        resolved.push({
          ...account,
          sources: [pw.source],
          passwords: [pw],
          allUrls: url ? [url] : account.allUrls,
          hasConflict: false,
          isSubdomainMerge: false,
          subdomainIsInteresting: false,
        })
      })
    } else {
      discarded.push(account)
    }
  })
  return { resolved, discarded }
}

/** Fan one row out into one row per URL. Returns `null` when the operation is a
 *  no-op (unknown row, or nothing to split), so the caller can skip the undo push. */
export function splitAll(rows: ReviewAccount[], rowId: string): ReviewAccount[] | null {
  const row = rows.find(r => r.id === rowId)
  if (!row || row.urls.length <= 1) return null
  return rows.flatMap(r => {
    if (r.id !== rowId) return [r]
    return r.urls.map((u, i) => ({
      ...r,
      id: `split-${rowId}-${i}-${u}`,
      urls: [u],
      origin: 'split' as const,
    }))
  })
}

/** Peel the given URLs off a row into their own rows, leaving the remainder behind.
 *  Returns `null` when nothing would change (unknown row, no matching URLs, or the
 *  selection covers every URL — that's `splitAll`'s job, not this one's). */
export function splitSelected(
  rows: ReviewAccount[],
  rowId: string,
  urls: string[],
): ReviewAccount[] | null {
  const row = rows.find(r => r.id === rowId)
  if (!row) return null
  const peeled = urls.filter(u => row.urls.includes(u))
  if (peeled.length === 0 || peeled.length === row.urls.length) return null
  const remaining = row.urls.filter(u => !peeled.includes(u))

  const out: ReviewAccount[] = []
  for (const r of rows) {
    if (r.id !== rowId) {
      out.push(r)
      continue
    }
    out.push({ ...r, urls: remaining })
    peeled.forEach((u, i) => {
      out.push({
        ...r,
        id: `split-${rowId}-${i}-${u}`,
        urls: [u],
        origin: 'split' as const,
      })
    })
  }
  return out
}

/** Merge rows sharing a `groupKey` back into one. `idSeed` is supplied by the caller
 *  (the store passes `Date.now()`) so this stays deterministic under test.
 *  Returns `null` for fewer than two targets or a mismatched `groupKey`. */
export function regroup(
  rows: ReviewAccount[],
  rowIds: string[],
  idSeed: number,
): ReviewAccount[] | null {
  const targets = rows.filter(r => rowIds.includes(r.id))
  if (targets.length < 2) return null
  const key = targets[0].groupKey
  if (!targets.every(t => t.groupKey === key)) return null

  const base = targets[0]
  const mergedUrls: string[] = []
  for (const t of targets) for (const u of t.urls) if (!mergedUrls.includes(u)) mergedUrls.push(u)
  const combined: ReviewAccount = {
    ...base,
    id: `regroup-${idSeed}-${key}`,
    urls: mergedUrls,
    origin: 'split',
  }

  const firstIdx = rows.findIndex(r => rowIds.includes(r.id))
  const filtered = rows.filter(r => !rowIds.includes(r.id))
  filtered.splice(firstIdx, 0, combined)
  return filtered
}
