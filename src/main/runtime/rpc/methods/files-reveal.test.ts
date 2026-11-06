import '../unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { EditorFileRevealTarget } from '../../../../shared/runtime-file-contracts'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { FILE_METHODS } from './files'

const PARAMS = {
  worktreeId: 'repo-1::/srv/app',
  filePath: '/srv/app/src/a.ts',
  relativePath: 'src/a.ts',
  executionHostId: 'runtime:env-1'
}

function request(params: unknown): RpcRequest {
  return { id: 'reveal-1', authToken: 'token', method: 'files.reveal', params }
}

function createDispatcher() {
  const revealEditorFile = vi.fn(async (target: EditorFileRevealTarget) => ({
    ...target,
    navigated: true
  }))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: files.reveal reads only these two runtime members.
  const runtime = {
    getRuntimeId: () => 'runtime-1',
    revealEditorFile
  } as unknown as OrcaRuntimeService
  return {
    revealEditorFile,
    dispatcher: new RpcDispatcher({ runtime, methods: FILE_METHODS })
  }
}

describe('files.reveal', () => {
  it.each(['runtime', 'mobile'] as const)(
    'refuses a paired %s client without touching the window',
    async (clientKind) => {
      const { revealEditorFile, dispatcher } = createDispatcher()

      const response = await dispatcher.dispatch(request(PARAMS), { clientKind })

      expect(response).toMatchObject({ ok: false, error: { code: 'forbidden' } })
      expect(revealEditorFile).not.toHaveBeenCalled()
    }
  )

  it('hands a local caller the server paths, position and diff intent', async () => {
    const { revealEditorFile, dispatcher } = createDispatcher()

    const response = await dispatcher.dispatch(
      request({ ...PARAMS, line: 12, column: 3, diff: { staged: true } })
    )

    expect(revealEditorFile).toHaveBeenCalledExactlyOnceWith({
      ...PARAMS,
      position: { line: 12, column: 3 },
      diff: { staged: true }
    })
    expect(response).toMatchObject({ ok: true, result: { reveal: { navigated: true } } })
  })
})
