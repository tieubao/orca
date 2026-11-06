import type { RuntimeFileOpenResult } from '../../shared/runtime-types'
import type { RuntimeNavigationTarget } from '../../shared/runtime-navigation'
import type { HandlerContext } from '../dispatch'
import { revealPairedFileOnLocalDesktop } from '../paired-file-desktop-reveal'
import { RuntimeClientError, type RuntimeRpcSuccess } from '../runtime-client'

const NO_APP_WINDOW_MESSAGE =
  'This Orca server has no app window, so it cannot open files as tabs. Nothing was opened.'

function isRendererUnavailable(error: unknown): boolean {
  return (
    error instanceof RuntimeClientError &&
    (error.code === 'renderer_unavailable' ||
      (error.code === 'runtime_error' && error.message === 'renderer_unavailable'))
  )
}

type FileOpenMethod = 'files.open' | 'files.openDiff'

type FileOpenParams = {
  worktree: string
  relativePath: string
  navigation: RuntimeNavigationTarget
  line?: number
  column?: number
  staged?: boolean
}

async function openOnServer(
  ctx: HandlerContext,
  method: FileOpenMethod,
  params: FileOpenParams
): Promise<RuntimeRpcSuccess<RuntimeFileOpenResult>> {
  if (!ctx.client.environmentSelector || params.navigation !== 'all') {
    return await ctx.client.call<RuntimeFileOpenResult>(method, params)
  }
  // Why first: the desktop on the CLI's machine is the one to move, even when the paired host is a desktop
  // with its own window. The host opens the tab unseen; its window moves only as the fallback.
  const opened = await ctx.client.call<RuntimeFileOpenResult>(method, {
    ...params,
    navigation: 'caller'
  })
  const { worktree, relativePath, line, column, staged } = params
  const revealed = await revealPairedFileOnLocalDesktop(ctx.client, {
    worktree,
    relativePath,
    ...(line === undefined ? {} : { position: { line, column } }),
    ...(method === 'files.openDiff' ? { diff: { staged: staged === true } } : {})
  })
  return revealed ? opened : await ctx.client.call<RuntimeFileOpenResult>(method, params)
}

/** Keep renderer_unavailable on the wire for mobile fallback; add CLI-specific recovery here. */
export async function callFileOpen(
  ctx: HandlerContext,
  method: FileOpenMethod,
  params: FileOpenParams
): Promise<RuntimeRpcSuccess<RuntimeFileOpenResult>> {
  try {
    return await openOnServer(ctx, method, params)
  } catch (error) {
    if (!isRendererUnavailable(error)) {
      throw error
    }
    throw new RuntimeClientError('renderer_unavailable', NO_APP_WINDOW_MESSAGE, {
      nextSteps: [
        'Open the file from the file explorer of an Orca app or mobile app connected to this server.',
        'To point a user at the file, give its path in your reply instead of opening a tab.'
      ]
    })
  }
}
