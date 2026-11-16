import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ImportSummaryScreen } from '@/components/wizard/ImportSummaryScreen'
import { useWizardStore } from '@/lib/store'
import { mergeEntries } from '@/lib/tauri'
import { makeConflictAccount, makeRawEntry } from '@/test/factories'

vi.mock('@/lib/tauri', () => ({
  parseCsvs: vi.fn(),
  mergeEntries: vi.fn(),
  pickCsvFile: vi.fn(),
  pickCsvFiles: vi.fn(),
  openDebugCsvWindow: vi.fn(),
}))

const mockMergeEntries = vi.mocked(mergeEntries)

beforeEach(() => {
  useWizardStore.getState().reset()
  vi.clearAllMocks()
})

describe('ImportSummaryScreen', () => {
  it('merges the uploads on first visit', async () => {
    useWizardStore.setState({ step: 'import-summary', rawEntries: [makeRawEntry()] })
    mockMergeEntries.mockResolvedValue([makeConflictAccount()])
    render(<ImportSummaryScreen />)
    expect(await screen.findByRole('button', { name: 'Resolve 1 conflict' })).toBeInTheDocument()
    expect(mockMergeEntries).toHaveBeenCalledTimes(1)
  })

  it('keeps conflict answers when the user comes Back to it', () => {
    const rawEntries = [makeRawEntry()]
    useWizardStore.setState({
      step: 'import-summary',
      rawEntries,
      lastMergedEntries: rawEntries,
      rawMergedAccounts: [makeConflictAccount()],
      conflictResolutions: { 0: { kind: 'discard' } },
    })
    render(<ImportSummaryScreen />)
    expect(mockMergeEntries).not.toHaveBeenCalled()
    expect(useWizardStore.getState().conflictResolutions).toEqual({ 0: { kind: 'discard' } })
  })
})
