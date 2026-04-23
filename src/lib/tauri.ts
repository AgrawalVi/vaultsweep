import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type { ImportTarget, MergedAccount, ParseResult, RawEntry } from "@/types/parser";

export function parseCsvs(targets: ImportTarget[]): Promise<ParseResult> {
  return invoke("parse_csvs", { targets });
}

export function mergeEntries(entries: RawEntry[]): Promise<MergedAccount[]> {
  return invoke("merge_entries", { entries });
}

export function pickCsvFile(): Promise<string | null> {
  return open({ filters: [{ name: "CSV", extensions: ["csv"] }] });
}
