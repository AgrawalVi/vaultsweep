import { useEffect } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { useWizardStore } from '@/lib/store'
import { openDebugCsvWindow } from '@/lib/tauri'

/**
 * Main-window half of the Cmd+Shift+D debug window: mirrors `rawEntries` and
 * `mergedAccounts` to it over Tauri events and opens it on the hotkey.
 *
 * Those payloads carry plaintext passwords, so this must only ever be mounted
 * behind `import.meta.env.DEV` (see App.tsx). Never render it unconditionally.
 */
export function DebugBridge() {
  const rawEntries = useWizardStore(s => s.rawEntries)
  const mergedAccounts = useWizardStore(s => s.mergedAccounts)

  // Emit raw entries and merged accounts to debug windows whenever they change
  useEffect(() => {
    emit('debug:raw-entries-updated', { entries: rawEntries }).catch(() => {})
  }, [rawEntries])

  useEffect(() => {
    emit('debug:merged-accounts-updated', { accounts: mergedAccounts }).catch(() => {})
  }, [mergedAccounts])

  // Respond to debug windows requesting the current data
  useEffect(() => {
    const unlistenEntries = listen('debug:request-raw-entries', () => {
      emit('debug:raw-entries-updated', { entries: rawEntries }).catch(() => {})
    })
    const unlistenAccounts = listen('debug:request-merged-accounts', () => {
      emit('debug:merged-accounts-updated', { accounts: mergedAccounts }).catch(() => {})
    })
    return () => {
      unlistenEntries.then(u => u())
      unlistenAccounts.then(u => u())
    }
  }, [rawEntries, mergedAccounts])

  // Cmd+Shift+D opens the CSV debug window
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        openDebugCsvWindow().catch(() => {})
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return null
}
