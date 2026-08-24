import { describe, expect, it } from 'vitest'
import {
  applyConflictResolutions,
  buildReviewAccounts,
  recomputeRawEntries,
  regroup,
  reviewToMergedAccount,
  splitAll,
  splitSelected,
  suggestUploadName,
} from '@/lib/wizard-logic'
import {
  makeConflictAccount,
  makeMergedAccount,
  makePasswordEntry,
  makeRawEntry,
  makeReviewAccount,
  makeSubdomainMerge,
  makeUpload,
} from '@/test/factories'

describe('suggestUploadName', () => {
  it('uses the bare category default for the first upload', () => {
    expect(suggestUploadName([], 'chromium')).toBe('Chrome')
    expect(suggestUploadName([], 'icloud')).toBe('Safari')
    expect(suggestUploadName([], 'firefox')).toBe('Firefox')
  })

  it('numbers subsequent uploads in the same category', () => {
    const uploads = [makeUpload({ category: 'chromium' })]
    expect(suggestUploadName(uploads, 'chromium')).toBe('Chrome (2)')
    expect(suggestUploadName([...uploads, makeUpload({ id: 'u2' })], 'chromium')).toBe('Chrome (3)')
  })

  it('counts only the matching category', () => {
    const uploads = [makeUpload({ category: 'firefox' }), makeUpload({ id: 'u2', category: 'icloud' })]
    expect(suggestUploadName(uploads, 'chromium')).toBe('Chrome')
  })
})

describe('recomputeRawEntries', () => {
  it("rewrites every entry's source to the upload's current name", () => {
    const uploads = [
      makeUpload({
        name: 'Arc – Personal',
        entries: [makeRawEntry({ source: 'stale' }), makeRawEntry({ source: 'stale' })],
      }),
    ]
    const out = recomputeRawEntries(uploads)
    expect(out).toHaveLength(2)
    expect(out.every(e => e.source === 'Arc – Personal')).toBe(true)
  })

  it('flattens uploads in order and leaves other fields intact', () => {
    const uploads = [
      makeUpload({ id: 'a', name: 'Chrome', entries: [makeRawEntry({ url: 'https://a.com' })] }),
      makeUpload({ id: 'b', name: 'Firefox', entries: [makeRawEntry({ url: 'https://b.com' })] }),
    ]
    expect(recomputeRawEntries(uploads).map(e => [e.source, e.url])).toEqual([
      ['Chrome', 'https://a.com'],
      ['Firefox', 'https://b.com'],
    ])
  })

  it('returns an empty list when no upload has entries', () => {
    expect(recomputeRawEntries([makeUpload(), makeUpload({ id: 'u2' })])).toEqual([])
  })
})

describe('applyConflictResolutions', () => {
  it('passes conflict-free accounts through untouched', () => {
    const clean = makeMergedAccount()
    const { resolved, discarded } = applyConflictResolutions([clean], {})
    expect(resolved).toEqual([clean])
    expect(discarded).toEqual([])
  })

  it('combine keeps only the chosen password and clears the conflict flag', () => {
    const { resolved } = applyConflictResolutions(
      [makeConflictAccount()],
      { 0: { kind: 'combine', passwordIdx: 1 } },
    )
    expect(resolved).toHaveLength(1)
    expect(resolved[0].passwords.map(p => p.password)).toEqual(['pw-safari'])
    expect(resolved[0].hasConflict).toBe(false)
  })

  it('combine falls back to the first password when the index is out of range', () => {
    const { resolved } = applyConflictResolutions(
      [makeConflictAccount()],
      { 0: { kind: 'combine', passwordIdx: 99 } },
    )
    expect(resolved[0].passwords.map(p => p.password)).toEqual(['pw-chrome'])
  })

  it('defaults to combine-first when a conflict has no resolution recorded', () => {
    const { resolved, discarded } = applyConflictResolutions([makeConflictAccount()], {})
    expect(resolved[0].passwords.map(p => p.password)).toEqual(['pw-chrome'])
    expect(resolved[0].hasConflict).toBe(false)
    expect(discarded).toEqual([])
  })

  it('separate emits one account per password, each keeping its own url and source', () => {
    const { resolved } = applyConflictResolutions(
      [makeConflictAccount()],
      { 0: { kind: 'separate' } },
    )
    expect(resolved).toHaveLength(2)
    expect(resolved.map(a => a.passwords[0].password)).toEqual(['pw-chrome', 'pw-safari'])
    expect(resolved.map(a => a.sources)).toEqual([['Chrome'], ['Safari']])
    expect(resolved.map(a => a.allUrls)).toEqual([
      ['https://example.com'],
      ['https://app.example.com'],
    ])
    expect(resolved.every(a => !a.hasConflict && !a.isSubdomainMerge)).toBe(true)
  })

  it('separate falls back to the account allUrls when a candidate has no url', () => {
    const account = makeConflictAccount({
      passwords: [
        makePasswordEntry({ password: 'pw-a', source: 'Chrome', url: null }),
        makePasswordEntry({ password: 'pw-b', source: 'Safari', url: null }),
      ],
      allUrls: ['https://example.com', 'https://app.example.com'],
    })
    const { resolved } = applyConflictResolutions([account], { 0: { kind: 'separate' } })
    expect(resolved).toHaveLength(2)
    expect(resolved[0].allUrls).toEqual(['https://example.com', 'https://app.example.com'])
    expect(resolved[1].allUrls).toEqual(['https://example.com', 'https://app.example.com'])
  })

  it('discard routes the account to discarded and never to resolved', () => {
    const { resolved, discarded } = applyConflictResolutions(
      [makeConflictAccount()],
      { 0: { kind: 'discard' } },
    )
    expect(resolved).toEqual([])
    expect(discarded).toHaveLength(1)
    expect(discarded[0].hasConflict).toBe(true)
  })

  it('keys resolutions by absolute index, not by position among conflicts', () => {
    const accounts = [
      makeMergedAccount({ normalizedDomain: 'clean-a.com' }),
      makeConflictAccount({ normalizedDomain: 'conflict.com' }),
      makeMergedAccount({ normalizedDomain: 'clean-b.com' }),
    ]
    // Index 1 is the only conflict — it is the second element overall, but the first conflict.
    const { resolved, discarded } = applyConflictResolutions(accounts, { 1: { kind: 'discard' } })
    expect(resolved.map(a => a.normalizedDomain)).toEqual(['clean-a.com', 'clean-b.com'])
    expect(discarded.map(a => a.normalizedDomain)).toEqual(['conflict.com'])
  })

  it('handles a mix of resolutions across several conflicts', () => {
    const accounts = [
      makeConflictAccount({ normalizedDomain: 'a.com' }),
      makeConflictAccount({ normalizedDomain: 'b.com' }),
      makeConflictAccount({ normalizedDomain: 'c.com' }),
    ]
    const { resolved, discarded } = applyConflictResolutions(accounts, {
      0: { kind: 'combine', passwordIdx: 0 },
      1: { kind: 'separate' },
      2: { kind: 'discard' },
    })
    expect(resolved.map(a => a.normalizedDomain)).toEqual(['a.com', 'b.com', 'b.com'])
    expect(discarded.map(a => a.normalizedDomain)).toEqual(['c.com'])
  })
})

describe('buildReviewAccounts', () => {
  it('keeps only subdomain merges', () => {
    const rows = buildReviewAccounts([
      makeMergedAccount({ normalizedDomain: 'plain.com' }),
      makeSubdomainMerge({ normalizedDomain: 'merged.com' }),
    ])
    expect(rows.map(r => r.domain)).toEqual(['merged.com'])
  })

  it('derives groupKey from domain and username', () => {
    const [row] = buildReviewAccounts([
      makeSubdomainMerge({ normalizedDomain: 'example.com', username: 'me@x.com' }),
    ])
    expect(row.groupKey).toBe('example.com|me@x.com')
    expect(row.origin).toBe('original')
  })

  it('carries subdomainIsInteresting through as fromInterestingMerge', () => {
    const rows = buildReviewAccounts([
      makeSubdomainMerge({ normalizedDomain: 'a.com', subdomainIsInteresting: true }),
      makeSubdomainMerge({ normalizedDomain: 'b.com', subdomainIsInteresting: false }),
    ])
    expect(rows.map(r => r.fromInterestingMerge)).toEqual([true, false])
  })

  it('copies urls and passwords rather than aliasing the source account', () => {
    const account = makeSubdomainMerge()
    const [row] = buildReviewAccounts([account])
    row.urls.push('https://mutated.example.com')
    row.passwords[0].password = 'mutated'
    expect(account.allUrls).toEqual(['https://one.example.com', 'https://two.example.com'])
    expect(account.passwords[0].password).not.toBe('mutated')
  })

  it('returns an empty list when nothing merged', () => {
    expect(buildReviewAccounts([makeMergedAccount()])).toEqual([])
  })
})

describe('reviewToMergedAccount', () => {
  it('round-trips an untouched row back to an equivalent account', () => {
    const account = makeSubdomainMerge()
    const [row] = buildReviewAccounts([account])
    const back = reviewToMergedAccount(row)
    expect(back.normalizedDomain).toBe(account.normalizedDomain)
    expect(back.username).toBe(account.username)
    expect(back.allUrls).toEqual(account.allUrls)
    expect(back.isSubdomainMerge).toBe(true)
    expect(back.subdomainIsInteresting).toBe(true)
  })

  it('demotes a single-url row out of subdomain-merge status', () => {
    const back = reviewToMergedAccount(makeReviewAccount({ urls: ['https://only.example.com'] }))
    expect(back.isSubdomainMerge).toBe(false)
    expect(back.subdomainIsInteresting).toBe(false)
  })

  it('never marks a rebuilt row as conflicted', () => {
    expect(reviewToMergedAccount(makeReviewAccount()).hasConflict).toBe(false)
  })

  it('keeps a multi-url row interesting only if its source merge was', () => {
    const boring = reviewToMergedAccount(makeReviewAccount({ fromInterestingMerge: false }))
    expect(boring.isSubdomainMerge).toBe(true)
    expect(boring.subdomainIsInteresting).toBe(false)
  })
})

describe('splitAll', () => {
  it('fans one row into one row per url', () => {
    const rows = [makeReviewAccount({ id: 'r1' })]
    const out = splitAll(rows, 'r1')
    expect(out).not.toBeNull()
    expect(out!).toHaveLength(2)
    expect(out!.map(r => r.urls)).toEqual([
      ['https://one.example.com'],
      ['https://two.example.com'],
    ])
    expect(out!.every(r => r.origin === 'split')).toBe(true)
    expect(new Set(out!.map(r => r.id)).size).toBe(2)
  })

  it('leaves the other rows in place and in order', () => {
    const rows = [
      makeReviewAccount({ id: 'before', urls: ['https://before.com'] }),
      makeReviewAccount({ id: 'r1' }),
      makeReviewAccount({ id: 'after', urls: ['https://after.com'] }),
    ]
    const out = splitAll(rows, 'r1')!
    expect(out.map(r => r.urls[0])).toEqual([
      'https://before.com',
      'https://one.example.com',
      'https://two.example.com',
      'https://after.com',
    ])
  })

  it('returns null for an unknown row id', () => {
    expect(splitAll([makeReviewAccount({ id: 'r1' })], 'nope')).toBeNull()
  })

  it('returns null when the row has nothing to split', () => {
    const rows = [makeReviewAccount({ id: 'r1', urls: ['https://only.com'] })]
    expect(splitAll(rows, 'r1')).toBeNull()
  })

  it('preserves the group key so split rows can be regrouped', () => {
    const out = splitAll([makeReviewAccount({ id: 'r1' })], 'r1')!
    expect(new Set(out.map(r => r.groupKey)).size).toBe(1)
  })
})

describe('splitSelected', () => {
  const threeUrls = ['https://a.example.com', 'https://b.example.com', 'https://c.example.com']

  it('peels the selected urls off and keeps the remainder on the original row', () => {
    const rows = [makeReviewAccount({ id: 'r1', urls: threeUrls })]
    const out = splitSelected(rows, 'r1', ['https://b.example.com'])!
    expect(out).toHaveLength(2)
    expect(out[0].urls).toEqual(['https://a.example.com', 'https://c.example.com'])
    expect(out[0].id).toBe('r1')
    expect(out[0].origin).toBe('original')
    expect(out[1].urls).toEqual(['https://b.example.com'])
    expect(out[1].origin).toBe('split')
  })

  it('peels several urls into one row each', () => {
    const rows = [makeReviewAccount({ id: 'r1', urls: threeUrls })]
    const out = splitSelected(rows, 'r1', ['https://a.example.com', 'https://c.example.com'])!
    expect(out.map(r => r.urls)).toEqual([
      ['https://b.example.com'],
      ['https://a.example.com'],
      ['https://c.example.com'],
    ])
  })

  it('ignores urls that are not on the row', () => {
    const rows = [makeReviewAccount({ id: 'r1', urls: threeUrls })]
    const out = splitSelected(rows, 'r1', ['https://b.example.com', 'https://elsewhere.com'])!
    expect(out).toHaveLength(2)
    expect(out[1].urls).toEqual(['https://b.example.com'])
  })

  it('returns null for an unknown row id', () => {
    expect(splitSelected([makeReviewAccount({ id: 'r1' })], 'nope', ['x'])).toBeNull()
  })

  it('returns null when no selected url matches', () => {
    const rows = [makeReviewAccount({ id: 'r1', urls: threeUrls })]
    expect(splitSelected(rows, 'r1', ['https://elsewhere.com'])).toBeNull()
  })

  it('returns null when the selection covers every url (that is splitAll)', () => {
    const rows = [makeReviewAccount({ id: 'r1', urls: threeUrls })]
    expect(splitSelected(rows, 'r1', threeUrls)).toBeNull()
  })

  it('leaves untargeted rows untouched', () => {
    const other = makeReviewAccount({ id: 'other', urls: ['https://other.com'] })
    const out = splitSelected(
      [other, makeReviewAccount({ id: 'r1', urls: threeUrls })],
      'r1',
      ['https://a.example.com'],
    )!
    expect(out[0]).toBe(other)
  })
})

describe('regroup', () => {
  const twoSplits = () => [
    makeReviewAccount({ id: 's1', urls: ['https://one.example.com'], origin: 'split' }),
    makeReviewAccount({ id: 's2', urls: ['https://two.example.com'], origin: 'split' }),
  ]

  it('unions the urls of the targeted rows', () => {
    const out = regroup(twoSplits(), ['s1', 's2'], 1234)!
    expect(out).toHaveLength(1)
    expect(out[0].urls).toEqual(['https://one.example.com', 'https://two.example.com'])
    expect(out[0].origin).toBe('split')
  })

  it('dedupes urls shared between the targeted rows', () => {
    const rows = [
      makeReviewAccount({ id: 's1', urls: ['https://a.com', 'https://shared.com'] }),
      makeReviewAccount({ id: 's2', urls: ['https://shared.com', 'https://b.com'] }),
    ]
    expect(regroup(rows, ['s1', 's2'], 1)![0].urls).toEqual([
      'https://a.com',
      'https://shared.com',
      'https://b.com',
    ])
  })

  it('derives the combined id from the supplied seed, not the clock', () => {
    const a = regroup(twoSplits(), ['s1', 's2'], 42)![0].id
    const b = regroup(twoSplits(), ['s1', 's2'], 42)![0].id
    expect(a).toBe(b)
    expect(a).toContain('42')
  })

  it('returns null when fewer than two rows are targeted', () => {
    expect(regroup(twoSplits(), ['s1'], 1)).toBeNull()
    expect(regroup(twoSplits(), [], 1)).toBeNull()
  })

  it('refuses to combine rows from different group keys', () => {
    const rows = [
      makeReviewAccount({ id: 's1', domain: 'a.com' }),
      makeReviewAccount({ id: 's2', domain: 'b.com' }),
    ]
    expect(regroup(rows, ['s1', 's2'], 1)).toBeNull()
  })

  it('removes every targeted row and keeps untargeted ones', () => {
    const rows = [
      ...twoSplits(),
      makeReviewAccount({ id: 'other', domain: 'other.com', urls: ['https://other.com'] }),
    ]
    const out = regroup(rows, ['s1', 's2'], 1)!
    expect(out).toHaveLength(2)
    expect(out.map(r => r.id)).not.toContain('s1')
    expect(out.map(r => r.id)).not.toContain('s2')
    expect(out.some(r => r.id === 'other')).toBe(true)
  })

  it('inherits title, sources and passwords from the first targeted row', () => {
    const rows = twoSplits()
    rows[0].title = 'First'
    rows[0].sources = ['Chrome']
    const out = regroup(rows, ['s1', 's2'], 1)!
    expect(out[0].title).toBe('First')
    expect(out[0].sources).toEqual(['Chrome'])
    expect(out[0].passwords).toHaveLength(1)
  })
})
