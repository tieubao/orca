import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClient } from '../runtime-client'

const mocks = vi.hoisted(() => ({ revealPairedFileOnLocalDesktop: vi.fn() }))

vi.mock('../paired-file-desktop-reveal', () => ({
  revealPairedFileOnLocalDesktop: mocks.revealPairedFileOnLocalDesktop
}))

import { FILE_HANDLERS } from './file'

function openResponse() {
  return {
    id: 'req-open',
    ok: true,
    result: { worktree: 'wt-1', relativePath: 'src/a.ts', kind: 'text', opened: true },
    _meta: { runtimeId: 'runtime-1' }
  }
}

async function run(
  command: 'file open' | 'file diff',
  options: { isRemote: boolean; focus: boolean; extra?: [string, string | boolean][] }
) {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const call = vi.fn().mockResolvedValue(openResponse())
  const focusFlags: [string, string | boolean][] = options.focus ? [['focus', true]] : []
  const client = new RuntimeClient('/tmp/orca-file-test', 60_000, null, null)
  vi.spyOn(client, 'call').mockImplementation(call)
  vi.spyOn(client, 'isRemote', 'get').mockReturnValue(options.isRemote)
  Object.defineProperty(client, 'environmentSelector', {
    value: options.isRemote ? 'winpc' : null
  })
  await FILE_HANDLERS[command]({
    flags: new Map<string, string | boolean>([
      ['path', 'src/a.ts'],
      ['worktree', 'id:wt-1'],
      ...focusFlags,
      ...(options.extra ?? [])
    ]),
    client,
    cwd: '/tmp/worktree',
    json: true
  })
  return call
}

describe('file open on a paired environment', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mocks.revealPairedFileOnLocalDesktop.mockReset()
  })

  it('moves the local desktop and leaves the paired host window alone', async () => {
    mocks.revealPairedFileOnLocalDesktop.mockResolvedValue(true)

    const call = await run('file open', {
      isRemote: true,
      focus: true,
      extra: [
        ['line', '12'],
        ['column', '3']
      ]
    })

    expect(mocks.revealPairedFileOnLocalDesktop).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ isRemote: true }),
      { worktree: 'id:wt-1', relativePath: 'src/a.ts', position: { line: 12, column: 3 } }
    )
    expect(call).toHaveBeenCalledExactlyOnceWith('files.open', {
      worktree: 'id:wt-1',
      relativePath: 'src/a.ts',
      navigation: 'caller',
      line: 12,
      column: 3
    })
  })

  it('has the paired host navigate itself when no local desktop shows the environment', async () => {
    mocks.revealPairedFileOnLocalDesktop.mockResolvedValue(false)

    const call = await run('file open', { isRemote: true, focus: true })

    expect(call.mock.calls.map(([, params]) => params.navigation)).toEqual(['caller', 'all'])
  })

  it('opens without moving any window when --focus is absent', async () => {
    const call = await run('file open', { isRemote: true, focus: false })

    expect(mocks.revealPairedFileOnLocalDesktop).not.toHaveBeenCalled()
    expect(call).toHaveBeenCalledExactlyOnceWith('files.open', {
      worktree: 'id:wt-1',
      relativePath: 'src/a.ts',
      navigation: 'caller'
    })
  })

  it('leaves a local server to its own window', async () => {
    const call = await run('file open', { isRemote: false, focus: true })

    expect(mocks.revealPairedFileOnLocalDesktop).not.toHaveBeenCalled()
    expect(call).toHaveBeenCalledExactlyOnceWith('files.open', {
      worktree: 'id:wt-1',
      relativePath: 'src/a.ts',
      navigation: 'all'
    })
  })

  it('reveals a diff with its staged side', async () => {
    mocks.revealPairedFileOnLocalDesktop.mockResolvedValue(true)

    const call = await run('file diff', {
      isRemote: true,
      focus: true,
      extra: [['staged', true]]
    })

    expect(mocks.revealPairedFileOnLocalDesktop).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ isRemote: true }),
      { worktree: 'id:wt-1', relativePath: 'src/a.ts', diff: { staged: true } }
    )
    expect(call).toHaveBeenCalledExactlyOnceWith('files.openDiff', {
      worktree: 'id:wt-1',
      relativePath: 'src/a.ts',
      staged: true,
      navigation: 'caller'
    })
  })
})
