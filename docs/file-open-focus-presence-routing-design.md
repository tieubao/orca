# Routing `file open --focus` to the paired desktop that is present

Status: design note, not implemented. Companion to the CLI-side `files.reveal` change (client side: the CLI runs on the machine whose desktop shows the paired environment).

## Problem

An agent hook runs `orca file open <path> --focus` on the runtime host (A). A is a desktop app that nobody watches. The user watches a paired desktop (B). Today `--focus` sends `navigation: 'all'`, and `openMobileFile` only reaches A's own window through `notifier.openFile`. B never hears about it.

## Where presence lives today

| Piece                   | File                                                                     | What it holds                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B reports its own state | `src/main/notifications/desktop-presence-reporter.ts`                    | Every 5 s B samples `readDesktopAwayState` and sends `notifications.reportDesktopPresence { away }` on each ready shared control socket. Suspend and lock latch away.         |
| Away definition         | `src/main/notifications/desktop-away-state.ts`                           | OS idle state or idle time over `DESKTOP_AWAY_SECONDS`. It is input idle time, not "Orca is the focused window".                                                              |
| A stores reports        | `src/main/runtime/push/notifications/desktop-client-presence-tracker.ts` | `Map<connectionId, { away, at }>`. `anyPresent(now)` is true on one fresh `away: false` report. Reports older than `DESKTOP_PRESENCE_TTL_MS` read as away.                    |
| A's own desktop         | `src/main/runtime/runtime-desktop-surface.ts`                            | `isAwayForMobileNotifications()`. Absent on a headless host, which then counts as away.                                                                                       |
| Combined answer         | `RuntimeMobileNotificationController.resolveDesktopAway()`               | `false` when any paired desktop is present, else the host surface answer. Only used to stamp `desktopAway` on notification events for the phone `onlyWhenDesktopAway` filter. |

Nothing outside `RuntimeMobileNotificationController` reads the tracker. The file-open path (`RuntimeFileAccess` to `RuntimeFileCommandHost.openFile` to `notifier.openFile`) has no handle on it.

## The route that would work

```
agent hook on A
  orca file open --focus      (navigation: 'all')
        |
        v
A  files.open handler
  |-- host window: notifier.openFile            (unchanged)
  `-- if host surface is away AND tracker has a present desktop:
        emit client event { type: 'openFile', worktreeId, relativePath, filePath,
                            position?, diff?, navigation }
        |
        v   runtime.clientEvents.subscribe stream (already carries activateWorktree)
B  runtime-client-ipc-bridge.ts
  `-- same shape as the existing activateWorktree branch:
        ensureRuntimeEventRepoKnown -> activate workspace -> open file focused
            with runtimeEnvironmentId = this environment
```

B already acts on `activateWorktree` events whose navigation targets clients, so a file event is the same pattern. B's renderer open path is the one `files.reveal` uses (`registerMobileAndTerminalCloseIpcBridge`, `openFileTab` / `openDiffTab`).

## Why it was not built here

The change is larger than a small follow-up and has parts nobody can check without two machines.

1. Plumbing on A: the tracker and host-away answer must reach the file-open path through `RuntimeFileCommandHost` and the runtime construction layer. About 60 lines plus tests.
2. A new `RuntimeClientEvent` variant and its handling in the paired desktop renderer, including repo-known and worktree-activation races. About 80 lines plus tests.
3. Every subscriber receives every client event. Phones and any other paired desktop would get it. Only a present desktop may act on it, which needs either per-connection delivery or a client-side presence check.
4. Total with tests is well above 300 lines, and the two-desktop behavior cannot be exercised in a unit test.

## Open questions for maintainers

1. Is the presence connection the subscription connection? Presence is keyed by the `connectionId` of the shared control socket that sent the report. `runtime.clientEvents.subscribe` goes through `shouldRouteSubscriptionBySupport` and may ride a different socket. If the IDs differ, A cannot target "the present desktop's stream". Is there a stable per-desktop identity (`pairedDeviceId`) both paths share?
2. Targeted or broadcast? Per-connection delivery needs a registry next to `registerSubscriptionCleanup`. Broadcast needs B to decide for itself, which means exposing its presence to the renderer (today only main reads it).
3. What does `all` mean for a file? For worktree activation, `all` already steers paired clients. For files it does not, and existing paired users would start getting yanked on every agent `--focus`. Should the presence gate apply only to files, or should `all` mean host plus clients everywhere?
4. Is idle time the right gate? B is "present" when the Mac has recent input, even if the user is in another app. That is right for push suppression and probably acceptable here, but a file popping into a window the user is not looking at may surprise them.
5. Compatibility: older B builds drop unknown event types (`event.type !== 'activateWorktree'` returns early), which is safe. Does the mobile client tolerate an unknown `RuntimeClientEvent` type? Not verified.
6. Layout-owner builds (`ORCA_LAYOUT_OWNER_IS_MAIN`): A writes the tab itself and B sees it through layout frames. Should the event carry a `tabId` for `showMainEditorTab` instead of re-opening the file on B?
7. Two present desktops: both would open the file. Acceptable, or pick the most recently active report?

## Suggested first step

Answer question 1. If the IDs match, a targeted `emitClientEventToPresentDesktops` on the runtime is the smallest clean route and the rest follows. If they differ, the cheaper route is a client-side presence check (question 2) and a broadcast event.
