import type { MergedAccount, PasswordEntry, RawEntry } from '@/types/parser'
import type { ReviewAccount, UploadedSource } from '@/lib/wizard-logic'

/** Fixture builders. `MergedAccount` has 11 fields and most tests care about two or
 *  three of them, so every factory takes a `Partial` overlay over sane defaults. */

/** Distinctive sentinel — greppable, and unlikely to collide with real UI text. */
export const SENTINEL_PASSWORD = 'ZZ-SENTINEL-9137'

export function makePasswordEntry(o: Partial<PasswordEntry> = {}): PasswordEntry {
  return {
    password: SENTINEL_PASSWORD,
    source: 'Chrome',
    url: 'https://example.com',
    ...o,
  }
}

export function makeRawEntry(o: Partial<RawEntry> = {}): RawEntry {
  return {
    source: 'Chrome',
    title: 'Example',
    url: 'https://example.com',
    username: 'user@example.com',
    password: SENTINEL_PASSWORD,
    notes: null,
    otpAuth: null,
    ...o,
  }
}

export function makeMergedAccount(o: Partial<MergedAccount> = {}): MergedAccount {
  return {
    normalizedDomain: 'example.com',
    username: 'user@example.com',
    sources: ['Chrome'],
    title: 'Example',
    notes: null,
    otpAuth: null,
    passwords: [makePasswordEntry()],
    hasConflict: false,
    allUrls: ['https://example.com'],
    isSubdomainMerge: false,
    subdomainIsInteresting: false,
    ...o,
  }
}

/** A merged account with two distinct passwords — the shape MergeConflictScreen consumes. */
export function makeConflictAccount(o: Partial<MergedAccount> = {}): MergedAccount {
  return makeMergedAccount({
    hasConflict: true,
    sources: ['Chrome', 'Safari'],
    passwords: [
      makePasswordEntry({ password: 'pw-chrome', source: 'Chrome', url: 'https://example.com' }),
      makePasswordEntry({ password: 'pw-safari', source: 'Safari', url: 'https://app.example.com' }),
    ],
    allUrls: ['https://example.com', 'https://app.example.com'],
    ...o,
  })
}

/** A subdomain merge — one password, several URLs. Drives the Review Merges screen. */
export function makeSubdomainMerge(o: Partial<MergedAccount> = {}): MergedAccount {
  return makeMergedAccount({
    isSubdomainMerge: true,
    subdomainIsInteresting: true,
    allUrls: ['https://one.example.com', 'https://two.example.com'],
    ...o,
  })
}

export function makeReviewAccount(o: Partial<ReviewAccount> = {}): ReviewAccount {
  const domain = o.domain ?? 'example.com'
  const username = o.username ?? 'user@example.com'
  return {
    id: 'row-1',
    groupKey: `${domain}|${username}`,
    domain,
    username,
    title: 'Example',
    notes: null,
    otpAuth: null,
    sources: ['Chrome'],
    passwords: [makePasswordEntry()],
    urls: ['https://one.example.com', 'https://two.example.com'],
    origin: 'original',
    fromInterestingMerge: true,
    ...o,
  }
}

export function makeUpload(o: Partial<UploadedSource> = {}): UploadedSource {
  return {
    id: 'upload-1',
    category: 'chromium',
    name: 'Chrome',
    path: '/tmp/chrome.csv',
    entries: [],
    error: null,
    pending: false,
    ...o,
  }
}
