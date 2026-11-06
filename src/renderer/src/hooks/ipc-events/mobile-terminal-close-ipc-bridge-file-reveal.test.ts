import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EditorFileRevealRequest } from '../../../../shared/runtime-file-contracts'
import { createTestStore, makeWorktree, seedStore } from '../../store/slices/store-test-helpers'
import { createStoreSessionMockApi } from '../../store/slices/store-session-test-harness'
import type * as HostPersistence from '@/lib/workspace-session-host-persistence'

const { storeRef, activateAndRevealWorkspace } = vi.hoisted(() => {
  const ref: { current: ReturnType<typeof createTestStore> | null } = { current: null }
  return { storeRef: ref, activateAndRevealWorkspace: vi.fn() }
})

function testStore(): ReturnType<typeof createTestStore> {
  if (!storeRef.current) {
    throw new Error('test store not created')
  }
  return storeRef.current
}

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('../../store', () => ({
  useAppStore: {
    getState: () => testStore().getState(),
    subscribe: (...args: Parameters<ReturnType<typeof createTestStore>['subscribe']>) =>
      testStore().subscribe(...args),
    setState: (...args: Parameters<ReturnType<typeof createTestStore>['setState']>) =>
      testStore().setState(...args)
  }
}))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorkspace }))
vi.mock('@/components/terminal-pane/closed-terminal-leaf-notice', () => ({
  applyClosedTerminalLeafNotice: vi.fn()
}))
vi.mock('@/components/terminal/terminal-tab-actions', () => ({ closeTerminalTab: vi.fn() }))
vi.mock('@/components/sidebar/workspace-actions/sleep/sleep-worktree-flow', () => ({
  runSleepWorktree: vi.fn()
}))
vi.mock('@/lib/workspace-session', () => ({ buildWorkspaceSessionPayload: vi.fn() }))
vi.mock('@/lib/workspace-session-host-persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof HostPersistence>()),
  persistWorkspaceSessionByHost: vi.fn()
}))

import { registerMobileAndTerminalCloseIpcBridge } from './mobile-terminal-close-ipc-bridge'

const WT = 'repo1::/srv/app'
const REQUEST: EditorFileRevealRequest = {
  requestId: 'req-1',
  worktreeId: WT,
  filePath: '/srv/app/src/a.ts',
  relativePath: 'src/a.ts',
  executionHostId: 'runtime:env-1'
}

function setup() {
  let reveal: ((request: EditorFileRevealRequest) => void) | undefined
  const replyTerminalPaneReveal = vi.fn()
  const noop = (): (() => void) => () => {}
  vi.stubGlobal('window', {
    api: {
      ...createStoreSessionMockApi(),
      ui: {
        onOpenFileFromMobile: noop,
        onOpenDiffFromMobile: noop,
        onCloseTerminal: noop,
        onWorkspaceSleep: noop,
        onResumeSleepingAgents: noop,
        onRevealEditorFile: (cb: (request: EditorFileRevealRequest) => void) => {
          reveal = cb
          return () => {}
        },
        replyTerminalPaneReveal
      }
    }
  })
  const store = createTestStore()
  storeRef.current = store
  seedStore(store, {
    worktreesByRepo: { repo1: [makeWorktree({ id: WT, repoId: 'repo1', path: '/srv/app' })] }
  })
  registerMobileAndTerminalCloseIpcBridge([], vi.fn())
  if (!reveal) {
    throw new Error('reveal listener was not registered')
  }
  return { reveal, replyTerminalPaneReveal, store }
}

afterEach(() => {
  activateAndRevealWorkspace.mockReset()
  vi.unstubAllGlobals()
})

describe("revealing a paired server's file in this window", () => {
  it("opens the server's file under the paired environment and answers yes", () => {
    activateAndRevealWorkspace.mockReturnValue({})
    const h = setup()

    h.reveal(REQUEST)

    expect(activateAndRevealWorkspace).toHaveBeenCalledWith(WT, {
      executionHostId: 'runtime:env-1'
    })
    expect(h.store.getState().openFiles).toEqual([
      expect.objectContaining({
        worktreeId: WT,
        filePath: '/srv/app/src/a.ts',
        relativePath: 'src/a.ts',
        runtimeEnvironmentId: 'env-1',
        mode: 'edit'
      })
    ])
    expect(h.replyTerminalPaneReveal).toHaveBeenCalledExactlyOnceWith({
      requestId: 'req-1',
      revealed: true
    })
  })

  it('opens a diff when the request carries one', () => {
    activateAndRevealWorkspace.mockReturnValue({})
    const h = setup()

    h.reveal({ ...REQUEST, diff: { staged: true } })

    expect(h.store.getState().openFiles).toEqual([
      expect.objectContaining({ worktreeId: WT, relativePath: 'src/a.ts', mode: 'diff' })
    ])
    expect(h.replyTerminalPaneReveal).toHaveBeenCalledWith({ requestId: 'req-1', revealed: true })
  })

  it('opens nothing and answers no when the window does not know the worktree', () => {
    activateAndRevealWorkspace.mockReturnValue(false)
    const h = setup()

    h.reveal(REQUEST)

    expect(h.store.getState().openFiles).toEqual([])
    expect(h.replyTerminalPaneReveal).toHaveBeenCalledExactlyOnceWith({
      requestId: 'req-1',
      revealed: false
    })
  })

  it('still answers when opening throws, so the caller is not left waiting', () => {
    activateAndRevealWorkspace.mockImplementation(() => {
      throw new Error('boom')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const h = setup()

    h.reveal(REQUEST)

    expect(h.replyTerminalPaneReveal).toHaveBeenCalledExactlyOnceWith({
      requestId: 'req-1',
      revealed: false
    })
  })
})
