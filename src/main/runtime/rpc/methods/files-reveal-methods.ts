import { defineMethod } from '../core'
import { FileReveal } from '../../../../shared/rpc-contract/files-params'

export const FILE_REVEAL_METHODS = [
  defineMethod({
    // Separate from files.open: only the desktop showing a paired server's worktree can reveal its file.
    name: 'files.reveal',
    permission: 'workspace',
    params: FileReveal,
    handler: async (params, { runtime, clientKind }) => {
      // Local callers may move this window; a paired client must not steer the host's.
      if (clientKind !== undefined) {
        throw Object.assign(
          new Error('files.reveal is available only to callers on this machine.'),
          { code: 'forbidden' }
        )
      }
      return {
        reveal: await runtime.revealEditorFile({
          worktreeId: params.worktreeId,
          filePath: params.filePath,
          relativePath: params.relativePath,
          executionHostId: params.executionHostId ?? null,
          ...(params.line === undefined
            ? {}
            : { position: { line: params.line, column: params.column } }),
          ...(params.diff ? { diff: params.diff } : {})
        })
      }
    }
  })
]
