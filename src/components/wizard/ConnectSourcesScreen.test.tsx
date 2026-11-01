import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectSourcesScreen } from '@/components/wizard/ConnectSourcesScreen'
import { useWizardStore } from '@/lib/store'
import { pickCsvFiles } from '@/lib/tauri'
import { makeRawEntry, makeUpload } from '@/test/factories'

vi.mock('@/lib/tauri', () => ({
  parseCsvs: vi.fn(),
  mergeEntries: vi.fn(),
  pickCsvFile: vi.fn(),
  pickCsvFiles: vi.fn(),
  openDebugCsvWindow: vi.fn(),
}))

const mockPickCsvFiles = vi.mocked(pickCsvFiles)
const get = () => useWizardStore.getState()

beforeEach(() => {
  useWizardStore.getState().reset()
  vi.clearAllMocks()
})

describe('ConnectSourcesScreen', () => {
  it('offers all three source categories', () => {
    render(<ConnectSourcesScreen />)
    expect(screen.getByText('Chrome-based browsers')).toBeInTheDocument()
    expect(screen.getByText('Firefox-based browsers')).toBeInTheDocument()
    expect(screen.getByText('Safari / iCloud Keychain')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Add file…' })).toHaveLength(3)
  })

  it('adds every file the picker returns, under the category that was clicked', async () => {
    const user = userEvent.setup()
    mockPickCsvFiles.mockResolvedValue(['/tmp/a.csv', '/tmp/b.csv'])
    const addUpload = vi.fn().mockResolvedValue(undefined)
    useWizardStore.setState({ addUpload })

    render(<ConnectSourcesScreen />)
    await user.click(screen.getAllByRole('button', { name: 'Add file…' })[1])

    await waitFor(() => expect(addUpload).toHaveBeenCalledTimes(2))
    expect(addUpload).toHaveBeenNthCalledWith(1, 'firefox', '/tmp/a.csv')
    expect(addUpload).toHaveBeenNthCalledWith(2, 'firefox', '/tmp/b.csv')
  })

  it('adds nothing when the picker is cancelled', async () => {
    const user = userEvent.setup()
    mockPickCsvFiles.mockResolvedValue([])
    const addUpload = vi.fn().mockResolvedValue(undefined)
    useWizardStore.setState({ addUpload })

    render(<ConnectSourcesScreen />)
    await user.click(screen.getAllByRole('button', { name: 'Add file…' })[0])

    await waitFor(() => expect(mockPickCsvFiles).toHaveBeenCalled())
    expect(addUpload).not.toHaveBeenCalled()
  })

  it('switches the button label once a category has a file', () => {
    useWizardStore.setState({ uploads: [makeUpload({ category: 'chromium' })] })
    render(<ConnectSourcesScreen />)
    expect(screen.getByRole('button', { name: 'Add another file…' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Add file…' })).toHaveLength(2)
  })

  it('reports each upload status: reading, error, or a row count', () => {
    useWizardStore.setState({
      uploads: [
        makeUpload({ id: 'u1', name: 'Reading one', pending: true }),
        makeUpload({ id: 'u2', name: 'Broken one', error: 'missing header' }),
        makeUpload({ id: 'u3', name: 'Good one', entries: [makeRawEntry(), makeRawEntry()] }),
      ],
    })
    render(<ConnectSourcesScreen />)
    expect(screen.getByText('Reading…')).toBeInTheDocument()
    expect(screen.getByText('missing header')).toBeInTheDocument()
    expect(screen.getByText('2 accounts')).toBeInTheDocument()
  })

  it('shows the file name and keeps the full path in the title attribute', () => {
    useWizardStore.setState({
      uploads: [makeUpload({ path: '/Users/me/Downloads/passwords.csv' })],
    })
    render(<ConnectSourcesScreen />)
    const label = screen.getByText('passwords.csv')
    expect(label).toHaveAttribute('title', '/Users/me/Downloads/passwords.csv')
  })

  it('disables the name field and remove button while an upload is pending', () => {
    useWizardStore.setState({ uploads: [makeUpload({ pending: true })] })
    render(<ConnectSourcesScreen />)
    expect(screen.getByLabelText('Source name')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove file' })).toBeDisabled()
  })

  describe('renaming', () => {
    beforeEach(() => {
      useWizardStore.setState({
        uploads: [makeUpload({ id: 'u1', name: 'Chrome', entries: [makeRawEntry()] })],
      })
    })

    it('commits a new name on blur', async () => {
      const user = userEvent.setup()
      render(<ConnectSourcesScreen />)
      const input = screen.getByLabelText('Source name')
      await user.clear(input)
      await user.type(input, 'Arc – Work')
      await user.tab()
      expect(get().uploads[0].name).toBe('Arc – Work')
    })

    it('commits on Enter', async () => {
      const user = userEvent.setup()
      render(<ConnectSourcesScreen />)
      const input = screen.getByLabelText('Source name')
      await user.clear(input)
      await user.type(input, 'Brave{Enter}')
      expect(get().uploads[0].name).toBe('Brave')
    })

    // BUG: Escape is supposed to discard the edit, but it commits it instead.
    // The keydown handler calls setLocalName(upload.name) and then blur() in the same
    // tick; React has not re-rendered yet, so the blur handler's `commit()` closes over
    // the *typed* name and renames to it. Marked `it.fails` — this flips red when fixed.
    it.fails('reverts on Escape', async () => {
      const user = userEvent.setup()
      render(<ConnectSourcesScreen />)
      const input = screen.getByLabelText('Source name')
      await user.clear(input)
      await user.type(input, 'Discarded{Escape}')
      expect(get().uploads[0].name).toBe('Chrome')
      expect(input).toHaveValue('Chrome')
    })

    it('currently commits the typed name on Escape (documents the bug above)', async () => {
      const user = userEvent.setup()
      render(<ConnectSourcesScreen />)
      const input = screen.getByLabelText('Source name')
      await user.clear(input)
      await user.type(input, 'Discarded{Escape}')
      expect(get().uploads[0].name).toBe('Discarded')
    })

    it('restores the previous name when the field is blanked', async () => {
      const user = userEvent.setup()
      render(<ConnectSourcesScreen />)
      const input = screen.getByLabelText('Source name')
      await user.clear(input)
      await user.tab()
      expect(get().uploads[0].name).toBe('Chrome')
      expect(input).toHaveValue('Chrome')
    })
  })

  it('removes an upload', async () => {
    const user = userEvent.setup()
    useWizardStore.setState({ uploads: [makeUpload({ id: 'u1' })] })
    render(<ConnectSourcesScreen />)
    await user.click(screen.getByRole('button', { name: 'Remove file' }))
    expect(get().uploads).toEqual([])
  })

  describe('the continue gate', () => {
    it('is closed with no uploads', () => {
      render(<ConnectSourcesScreen />)
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    })

    it('is closed while an upload is still reading', () => {
      useWizardStore.setState({ uploads: [makeUpload({ pending: true })] })
      render(<ConnectSourcesScreen />)
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    })

    it('is closed for a failed upload', () => {
      useWizardStore.setState({ uploads: [makeUpload({ error: 'bad header' })] })
      render(<ConnectSourcesScreen />)
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    })

    it('is closed for a file that parsed to zero entries', () => {
      useWizardStore.setState({ uploads: [makeUpload({ entries: [] })] })
      render(<ConnectSourcesScreen />)
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    })

    it('opens as soon as one upload has entries', async () => {
      const user = userEvent.setup()
      useWizardStore.setState({
        step: 'connect-sources',
        uploads: [makeUpload({ error: 'bad' }), makeUpload({ id: 'u2', entries: [makeRawEntry()] })],
      })
      render(<ConnectSourcesScreen />)
      const advance = screen.getByRole('button', { name: 'Continue' })
      expect(advance).toBeEnabled()
      await user.click(advance)
      expect(get().step).toBe('import-summary')
    })
  })

  it('groups uploads under their own category card', () => {
    useWizardStore.setState({
      uploads: [
        makeUpload({ id: 'u1', category: 'chromium', name: 'Chrome' }),
        makeUpload({ id: 'u2', category: 'icloud', name: 'Safari' }),
      ],
    })
    render(<ConnectSourcesScreen />)
    const chromeCard = screen.getByText('Chrome-based browsers').closest<HTMLElement>('[data-slot="card"]')!
    expect(within(chromeCard).getByDisplayValue('Chrome')).toBeInTheDocument()
    expect(within(chromeCard).queryByDisplayValue('Safari')).not.toBeInTheDocument()
  })
})
