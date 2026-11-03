# Agent Inbox

An agent-first inbox for [Paseo](https://github.com/getpaseo/paseo): one compact list of the top-level agents on every connected host, with **Settle** and **Snooze** for lightweight attention management. Clicking a row opens the agent's native chat; replies, permission approvals and everything else happen there.

Forked from [omercnet's Agent Monitor](https://github.com/omercnet/paseo-plugins/tree/main/agent-monitor) (4.4.1, commit `eaa702b`). MIT, original copyright retained in `LICENSE`.

## What it does

- **All hosts, one list.** Every online host is listed and merged. Each agent is identified by `serverId/agentId`, so the same title or id on two hosts never collides. A host that fails or goes offline is reported and skipped; the other hosts keep working.
- **Subagents hidden by default.** An agent is a subagent when its own metadata names a parent (`parentAgentId` on 0.15, the `paseo.parent-agent-id` / `paseo.parent-server-id` labels on 0.14). That holds for nested, cross-workspace and cross-host children, and for children whose parent is offline or archived. Detaching removes those labels, so a detached agent shows up as top level. Agents without parent metadata are always shown; titles are never used. The list, chips, search, sidebar badge and popover all derive from the same item set.
- **Views:** Needs attention · Running · Idle · All, plus Settled / Snoozed when non-empty. Optional host filter (default All hosts), sort (Triage / Recent / Title), and search.
- **States follow Paseo's own classification** (`deriveAgentStateBucket`): a pending permission or an error is attention; running and initializing are running; otherwise the native `requiresAttention` flag (finished unread) is attention; the rest is idle. `closed` means the runtime was released but the agent is resumable, so it counts as idle (or attention when it finished unread), never as archived. Archived agents are not listed.

## Settle and Snooze

Both are the inbox's own records. They never change the agent, its unread state or its native attention flag.

| Paseo state     | Inbox action | Inbox shows                              |
| --------------- | ------------ | ---------------------------------------- |
| Needs attention | —            | In the queue                             |
| Needs attention | Settle       | Settled (in All / Settled), not counted  |
| Needs attention | Snooze       | Snoozed until the wake time, not counted |
| Running / Idle  | —            | Running / Idle (triage does not apply)   |

Each record stores the **attention signature** the user saw:

- `reason@attentionTimestamp`. The daemon stamps this when it raises attention, persists it, and does not rewrite it while attention stays set.
- The ids of pending permission requests.
- `lastUserMessageAt`.
- The error text while the agent is in error.

`updatedAt`, titles, labels and re-syncs are ignored, so a refresh, reconnect or rename never revives a settled agent.

A record stops applying when the agent shows something new:

- A new permission id.
- A new error.
- A new attention timestamp (another finished turn).
- A new user prompt: native attention is _not_ reset by a follow-up prompt.

It also stops applying once the agent leaves attention: read natively, resumed, or running. Any open client then deletes the record, so the supersession is permanent. Snoozes also end at their absolute wake time; the view re-renders at that moment. Snooze presets are 1 hour, 4 hours, and tomorrow 09:00 in the client's local time zone. **Undo settle** and **Unsnooze** delete the record.

### Storage

The records live in a host-scoped Paseo settings document (`triage`) of the host the plugin is installed on. It is atomic and revisioned, survives plugin reloads, daemon restarts and reconnects, and is shared live by every client of that host. Writes happen only on user actions and when a record has become obsolete, never on polling. Revision conflicts between clients are retried against the fresh document. Records of agents on offline hosts are kept; they expire after 30 days unobserved.

**Install the plugin on one host.** Records from every host are stored on that one. If you install it on several hosts, each keeps its own separate Settle/Snooze state, and the sidebar uses whichever host you last picked for the plugin.

## Install

Requires Paseo 0.14. Plugins are trusted, unsandboxed code. Plugins must be enabled on the target daemon (`"pluginsEnabled": true` in its `config.json`, then `paseo daemon reload`).

```sh
cd ~/Sync/infra/paseo-agents-monitor
npm install          # dev dependencies, for checks only
npm run typecheck && npm test

paseo plugin install ~/Sync/infra/paseo-agents-monitor            # local daemon
paseo plugin install ~/Sync/infra/paseo-agents-monitor --host <host:port>   # or another host
paseo plugin ls
```

It installs as `agent-inbox`, separate from `agent-monitor`, so both can run side by side.

- **Update** after pulling changes: `paseo plugin reload agent-inbox`. A failed reload stays failed; fix and reload again.
- **Disable / roll back:** `paseo plugin disable agent-inbox`, or `paseo plugin remove agent-inbox`. Removing deletes its settings and triage documents; the source directory is never deleted. Agent Monitor is unaffected either way.

## Development

```sh
npm run typecheck   # tsc against @getpaseo/plugin 0.14.0
npm test            # vitest
npm run check       # biome
```

Pure logic lives in `client/triage.ts` (signatures, new-event detection, snooze and pruning) and `client/inbox.ts` (top-level filter, views, counts, ordering). `client/use-inbox.ts` combines the multi-host query (`client/monitor-data.ts`, inherited), the triage store (`client/triage-store.ts`) and the preferences into the one derivation every surface reads.

To verify an install the way users get it, install a packed copy into an isolated daemon, never `~/.paseo`:

```sh
W=$(mktemp -d); mkdir -p $W/home $W/x
echo '{"version":1,"daemon":{"listen":"127.0.0.1:6799"},"pluginsEnabled":true}' > $W/home/config.json
npm pack --ignore-scripts --pack-destination $W && tar -xzf $W/*.tgz -C $W/x
paseo daemon start --home $W/home
paseo plugin install $W/x/package --host 127.0.0.1:6799 --json   # expect "status": "running"
paseo daemon stop --home $W/home
```

## Differences from Agent Monitor

- Subagents are excluded from the list, counts and badge unless **Show subagents** is on. When on, children nest under their parents.
- Settle and Snooze are added, with their own `triage` settings document.
- Attention follows Paseo's native order: an unread finished `closed` agent is attention, where Agent Monitor files it under Closed.
- Removed: Graph view, Overview / mission control, project / workspace / host / provider grouping, diff stats, pin markers, density, keyboard shortcuts, next/previous cycling, and archive actions (single and bulk). The inbox performs no lifecycle action at all.
- Workspace and project directories are no longer loaded; rows read placement from each agent entry. That means fewer requests per refresh.
- Row identity is `serverId/agentId` (Agent Monitor keyed rows by agent id alone).
- Plugin id `agent-inbox`; preferences document `inbox` (`showSubagents`, `agentSort`, `showPlacement`, `defaultView`).
