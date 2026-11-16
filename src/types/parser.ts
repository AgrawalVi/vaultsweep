export type BrowserFormat = "icloud" | "chromium" | "firefox";

export interface ImportTarget {
  format: BrowserFormat;
  /** User-facing label shown in triage, e.g. "Arc – Personal", "Brave", "Firefox". */
  name: string;
  /** Absolute path to the CSV file, from the file picker. */
  path: string;
}

export interface RawEntry {
  source: string;
  title: string | null;
  url: string | null;
  username: string | null;
  password: string;
  notes: string | null;
  otpAuth: string | null;
}

export interface ParseWarning {
  source: string;
  row: number;
  message: string;
}

export interface SourceError {
  source: string;
  message: string;
}

export interface ParseResult {
  entries: RawEntry[];
  warnings: ParseWarning[];
  errors: SourceError[];
}

export interface PasswordEntry {
  /** Opaque handle assigned by the merger, `pw:{accountId}#{i}`. Never contains the password. */
  passwordId: string;
  password: string;
  /** Every source this password was found in (distinct, first-seen order). */
  sources: string[];
  /** Every original URL this password was saved under (distinct, first-seen order; empty
   *  when none had a URL). The conflict UI shows them per candidate and "Keep separate"
   *  carries them over, so no copy is lost when one password was saved in several places. */
  urls: string[];
}

export interface MergedAccount {
  /** Stable identity. The merger assigns `acct:{normalizedDomain}|{username}`; accounts
   *  fanned out later (keep separate, review splits) get a `childId` of their parent. */
  id: string;
  normalizedDomain: string;
  username: string;
  sources: string[];
  title: string | null;
  notes: string | null;
  otpAuth: string | null;
  passwords: PasswordEntry[];
  hasConflict: boolean;
  /** All original URLs contributing to this merged account (distinct, insertion order). */
  allUrls: string[];
  /** True when two or more distinct subdomains merged into this account (same password). */
  isSubdomainMerge: boolean;
  /** True when at least one merged subdomain is not in the boring set (www/mail/accounts/etc). */
  subdomainIsInteresting: boolean;
}
