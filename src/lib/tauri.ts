import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

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

export async function openDebugCsvWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel("debug-csv");
  if (existing) {
    await existing.setFocus();
    return;
  }
  new WebviewWindow("debug-csv", {
    url: "/#debug-csv",
    title: "Debug: CSV Entries",
    width: 1000,
    height: 640,
    resizable: true,
  });
}
