Agent Inbox is one compact list of the top-level agents on every connected host, so you can see which ones need you without walking the workspace tree. Click a row to open the agent's native chat.

Subagents are hidden by default, from the list, the counts and the sidebar badge alike, based on each agent's own parent metadata. **Settle** takes an agent out of the attention queue until a genuinely new event (new permission request, error, finished turn or user prompt). **Snooze** hides it until 1 hour, 4 hours or tomorrow 9:00, and wakes it early on a new event.

Settle and Snooze are the inbox's own state, stored in a settings document on the host the plugin is installed on. The plugin never renames, archives, stops, prompts or marks agents read.

Forked from omercnet's Agent Monitor. Requires Paseo ^0.14.0.
