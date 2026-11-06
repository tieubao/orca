import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  desktopCall: vi.fn(),
  desktopClient: vi.fn(),
  resolveEnvironment: vi.fn()
}))

vi.mock('./runtime-client', () => ({
  RuntimeClient: class {
    call = mocks.desktopCall
    constructor(...args: unknown[]) {
      mocks.desktopClient(...args)
    }
  }
}))
vi.mock('./runtime/environments', () => ({ resolveEnvironment: mocks.resolveEnvironment }))

import type { RuntimeClient } from './runtime-client'
import { revealPairedFileOnLocalDesktop } from './paired-file-desktop-reveal'

const SERVER_WORKTREE = { id: 'repo-1::/srv/app', path: '/srv/app' }
const REVEAL = { worktree: 'id:repo-1::/srv/app', relativePath: 'src/a.ts' }

function pairedClient(environmentSelector: string | null) {
  const serverCall = vi.fn(async () => ({ ok: true, result: { worktree: SERVER_WORKTREE } }))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the reveal reads only these three members.
  const client = {
    environmentSelector,
    userDataPath: '/profile',
    call: serverCall
  } as unknown as RuntimeClient
  return { client, serverCall }
}

describe('revealPairedFileOnLocalDesktop', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.resolveEnvironment.mockReturnValue({ id: 'env/1' })
    mocks.desktopCall.mockImplementation(async (_method: string, params: object) => ({
      ok: true,
      result: { reveal: { ...params, navigated: true } }
    }))
  })

  it("shows a paired server's file in this machine's desktop window", async () => {
    const { client, serverCall } = pairedClient('winpc')

    await expect(
      revealPairedFileOnLocalDesktop(client, { ...REVEAL, position: { line: 12, column: 3 } })
    ).resolves.toBe(true)

    expect(mocks.resolveEnvironment).toHaveBeenCalledWith('/profile', 'winpc')
    expect(serverCall).toHaveBeenCalledWith(
      'worktree.show',
      { worktree: REVEAL.worktree },
      { timeoutMs: 12_000 }
    )
    // null bypasses ambient remote selection so reveal reaches the local desktop.
    expect(mocks.desktopClient).toHaveBeenCalledWith('/profile', 12_000, null, null)
    expect(mocks.desktopCall).toHaveBeenCalledWith('files.reveal', {
      worktreeId: SERVER_WORKTREE.id,
      filePath: '/srv/app/src/a.ts',
      relativePath: 'src/a.ts',
      executionHostId: 'runtime:env%2F1',
      line: 12,
      column: 3
    })
  })

  it("joins a Windows server's root with backslashes and forwards the diff side", async () => {
    const { client, serverCall } = pairedClient('winpc')
    serverCall.mockResolvedValue({
      ok: true,
      result: { worktree: { id: 'repo-1::C:\\app', path: 'C:\\app' } }
    })

    await revealPairedFileOnLocalDesktop(client, { ...REVEAL, diff: { staged: true } })

    expect(mocks.desktopCall).toHaveBeenCalledWith(
      'files.reveal',
      expect.objectContaining({ filePath: 'C:\\app\\src\\a.ts', diff: { staged: true } })
    )
  })

  it('asks no desktop when the client is not talking to a paired environment', async () => {
    const { client, serverCall } = pairedClient(null)

    await expect(revealPairedFileOnLocalDesktop(client, REVEAL)).resolves.toBe(false)

    expect(serverCall).not.toHaveBeenCalled()
    expect(mocks.desktopClient).not.toHaveBeenCalled()
  })

  it('asks no desktop when the server no longer knows the worktree', async () => {
    const { client, serverCall } = pairedClient('winpc')
    serverCall.mockRejectedValue(new Error('selector_not_found'))

    await expect(revealPairedFileOnLocalDesktop(client, REVEAL)).resolves.toBe(false)

    expect(mocks.desktopClient).not.toHaveBeenCalled()
  })

  it.each([
    ['no desktop is running here', new Error('runtime_unavailable')],
    ['an older desktop lacks the method', new Error('method_not_found')]
  ])('falls back to the host when %s', async (_case, failure) => {
    const { client } = pairedClient('winpc')
    mocks.desktopCall.mockRejectedValue(failure)

    await expect(revealPairedFileOnLocalDesktop(client, REVEAL)).resolves.toBe(false)
  })

  it('reports false when the desktop does not know the worktree', async () => {
    const { client } = pairedClient('winpc')
    mocks.desktopCall.mockResolvedValue({ ok: true, result: { reveal: { navigated: false } } })

    await expect(revealPairedFileOnLocalDesktop(client, REVEAL)).resolves.toBe(false)
  })
})
