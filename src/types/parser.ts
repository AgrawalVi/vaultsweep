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
  password: string;
  source: string;
}

export interface MergedAccount {
  normalizedDomain: string;
  username: string;
  sources: string[];
  title: string | null;
  notes: string | null;
  otpAuth: string | null;
  passwords: PasswordEntry[];
  hasConflict: boolean;
}
