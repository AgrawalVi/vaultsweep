import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { emit, listen } from '@tauri-apps/api/event'
import App from '@/App'
import { useWizardStore } from '@/lib/store'
import { openDebugCsvWindow } from '@/lib/tauri'
import { SENTINEL_PASSWORD, makeMergedAccount, makeRawEntry } from '@/test/factories'

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

vi.mock('@/lib/tauri', () => ({
  parseCsvs: vi.fn(),
  mergeEntries: vi.fn(),
  pickCsvFile: vi.fn(),
  pickCsvFiles: vi.fn(),
  openDebugCsvWindow: vi.fn(() => Promise.resolve()),
}))

const mockEmit = vi.mocked(emit)
const mockListen = vi.mocked(listen)
const mockOpenDebugCsvWindow = vi.mocked(openDebugCsvWindow)

function pressDebugHotkey() {
  fireEvent.keyDown(window, { key: 'D', metaKey: true, shiftKey: true })
}

function seedStoreWithSentinel() {
  useWizardStore.setState({
    rawEntries: [makeRawEntry({ password: SENTINEL_PASSWORD })],
    mergedAccounts: [makeMergedAccount()],
  })
}

beforeEach(() => {
  useWizardStore.getState().reset()
  vi.clearAllMocks()
  window.location.hash = ''
})

afterEach(() => {
  vi.unstubAllEnvs()
  window.location.hash = ''
})

describe('App debug tooling', () => {
  describe('in a dev build', () => {
    beforeEach(() => {
      vi.stubEnv('DEV', true)
    })

    it('mirrors store data to the debug window', () => {
      seedStoreWithSentinel()
      render(<App />)

      const events = mockEmit.mock.calls.map(([event]) => event)
      expect(events).toContain('debug:raw-entries-updated')
      expect(events).toContain('debug:merged-accounts-updated')
      expect(mockListen).toHaveBeenCalledWith('debug:request-raw-entries', expect.any(Function))
    })

    it('opens the debug window on Cmd+Shift+D', () => {
      render(<App />)
      pressDebugHotkey()
      expect(mockOpenDebugCsvWindow).toHaveBeenCalledTimes(1)
    })
  })

  describe('in a release build', () => {
    beforeEach(() => {
      vi.stubEnv('DEV', false)
    })

    it('never sends store data over Tauri events', () => {
      seedStoreWithSentinel()
      render(<App />)

      expect(mockEmit).not.toHaveBeenCalled()
      expect(mockListen).not.toHaveBeenCalled()
      expect(JSON.stringify(mockEmit.mock.calls)).not.toContain(SENTINEL_PASSWORD)
    })

    it('ignores Cmd+Shift+D', () => {
      render(<App />)
      pressDebugHotkey()
      expect(mockOpenDebugCsvWindow).not.toHaveBeenCalled()
    })

    it('shows the wizard, not the debug view, at #debug-csv', () => {
      window.location.hash = '#debug-csv'
      render(<App />)

      expect(mockListen).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument()
    })
  })
})
