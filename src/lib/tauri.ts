import { invoke } from "@tauri-apps/api/core";

import type { ImportTarget, ParseResult } from "@/types/parser";

export function parseCsvs(targets: ImportTarget[]): Promise<ParseResult> {
  return invoke("parse_csvs", { targets });
}
