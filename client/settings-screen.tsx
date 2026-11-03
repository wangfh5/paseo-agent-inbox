import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
import { type InboxSettings, inboxSettings } from "../shared/inbox-settings";
import { triageSettings } from "../shared/triage-settings";

export function InboxSettingsScreen({ theme }: PluginSurfaceProps) {
  const prefs = useSettings(inboxSettings);
  const triage = useSettings(triageSettings);
  const muted = { color: theme.colors.foregroundMuted };
  const danger = { color: theme.colors.statusDanger };

  if (prefs.status === "loading") return <Text style={muted}>Loading settings…</Text>;
  if (prefs.status !== "ready") {
    return (
      <SettingsSection title="Inbox">
        <Text style={danger}>{prefs.error}</Text>
        <SettingsCard>
          <SettingsAction
            label="Reset preferences"
            actionLabel="Reset"
            disabled={prefs.saving}
            onPress={() => void prefs.reset()}
          />
        </SettingsCard>
      </SettingsSection>
    );
  }
  const save = (patch: Partial<InboxSettings>) =>
    void prefs.save({ ...prefs.values, ...patch }, prefs.revision);
  const recordCount = triage.status === "ready" ? Object.keys(triage.values.records).length : 0;

  return (
    <>
      <SettingsSection title="Inbox">
        <SettingsCard>
          <SettingsSwitch
            label="Show subagents"
            hint="Off: only top-level agents appear in the list, counts and sidebar badge"
            value={prefs.values.showSubagents}
            disabled={prefs.saving}
            onValueChange={(showSubagents) => save({ showSubagents })}
          />
          <SettingsSwitch
            label="Show project / workspace"
            hint="Placement and branch under each title"
            value={prefs.values.showPlacement}
            disabled={prefs.saving}
            onValueChange={(showPlacement) => save({ showPlacement })}
          />
        </SettingsCard>
        {prefs.saveError ? <Text style={danger}>{prefs.saveError}</Text> : null}
      </SettingsSection>
      <SettingsSection title="Settle and snooze">
        <SettingsCard>
          <SettingsAction
            label="Clear all settles and snoozes"
            hint={
              triage.status === "ready"
                ? `${recordCount} saved. Only inbox state; agents are not touched.`
                : triage.status === "loading"
                  ? "Loading…"
                  : `Unreadable: ${triage.error}`
            }
            actionLabel={triage.status === "ready" ? "Clear" : "Reset"}
            disabled={triage.saving || triage.status === "loading"}
            onPress={() => void triage.reset()}
          />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
