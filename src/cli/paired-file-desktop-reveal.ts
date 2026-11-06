import { toRuntimeExecutionHostId } from '../shared/execution-host'
import type { RuntimeEditorFileReveal } from '../shared/runtime-file-contracts'
import type { RuntimeWorktreeRecord } from '../shared/runtime-worktree-contracts'
import { joinWorktreeRelativePath } from '../main/runtime/files/paths/runtime-relative-paths'
import { RuntimeClient } from './runtime-client'
import { resolveEnvironment } from './runtime/environments'

// Just past the desktop's 10 s renderer wait; bounds the paired host's worktree.show and the local client.
const LOCAL_DESKTOP_REVEAL_TIMEOUT_MS = 12_000

export type PairedFileReveal = {
  worktree: string
  relativePath: string
  position?: { line: number; column?: number }
  diff?: { staged: boolean; oldPath?: string }
}

/** Reveal a paired environment's file on this machine's desktop, the window the CLI user sees. */
export async function revealPairedFileOnLocalDesktop(
  client: RuntimeClient,
  reveal: PairedFileReveal
): Promise<boolean> {
  if (!client.environmentSelector) {
    return false
  }
  try {
    const environment = resolveEnvironment(client.userDataPath, client.environmentSelector)
    const { worktree } = (
      await client.call<{ worktree: RuntimeWorktreeRecord }>(
        'worktree.show',
        { worktree: reveal.worktree },
        { timeoutMs: LOCAL_DESKTOP_REVEAL_TIMEOUT_MS }
      )
    ).result
    const desktop = new RuntimeClient(
      client.userDataPath,
      LOCAL_DESKTOP_REVEAL_TIMEOUT_MS,
      null,
      null
    )
    const revealed = await desktop.call<{ reveal: RuntimeEditorFileReveal }>('files.reveal', {
      worktreeId: worktree.id,
      filePath: joinWorktreeRelativePath(worktree.path, reveal.relativePath),
      relativePath: reveal.relativePath,
      executionHostId: toRuntimeExecutionHostId(environment.id),
      ...reveal.position,
      ...(reveal.diff ? { diff: reveal.diff } : {})
    })
    return revealed.result.reveal.navigated
  } catch {
    return false
  }
}
