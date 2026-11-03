import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { formatWake } from "./inbox";
import {
  type CustomSnooze,
  customSnoozeDefaults,
  type DurationUnit,
  parseCustomSnooze,
  snoozeOptions,
} from "./triage";

type Theme = PluginSurfaceProps["theme"];

/** The preset list: label on the left, wake time on the right, then "Custom…". */
export function SnoozeMenu({
  theme,
  now,
  onPick,
  onCustom,
}: {
  theme: Theme;
  now: number;
  onPick(until: number): void;
  onCustom(): void;
}) {
  const styles = useMemo(
    () => ({
      menu: {
        marginTop: 6,
        paddingVertical: 4,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      item: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 12,
        minHeight: 34,
        paddingHorizontal: 12,
      },
      label: { flex: 1, color: theme.colors.foreground, fontSize: 14 },
      time: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        fontVariant: ["tabular-nums" as const],
      },
      divider: {
        height: 1,
        marginVertical: 4,
        marginHorizontal: 12,
        backgroundColor: theme.colors.border,
      },
      hovered: { backgroundColor: theme.colors.surface1 },
    }),
    [theme],
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const item = (id: string, label: string, time: string | null, onPress: () => void) => (
    <Pressable
      key={id}
      accessibilityRole="menuitem"
      accessibilityLabel={time ? `${label}, ${time}` : label}
      onPress={onPress}
      onPointerEnter={() => setHovered(id)}
      onPointerLeave={() => setHovered((current) => (current === id ? null : current))}
      style={[styles.item, hovered === id && styles.hovered]}
    >
      <Text style={styles.label}>{label}</Text>
      {time ? <Text style={styles.time}>{time}</Text> : null}
    </Pressable>
  );
  return (
    <View accessibilityRole="menu" style={styles.menu}>
      {snoozeOptions(now).map((option) =>
        item(option.id, option.label, formatWake(option.until, now, true), () =>
          onPick(option.until),
        ),
      )}
      <View style={styles.divider} />
      {item("custom", "Custom…", null, onCustom)}
    </View>
  );
}

const UNITS: readonly { id: DurationUnit; label: string }[] = [
  { id: "minutes", label: "Minutes" },
  { id: "hours", label: "Hours" },
  { id: "days", label: "Days" },
];

/** Pick an exact local date and time, or a duration from now. */
export function CustomSnoozeModal({
  theme,
  open,
  title,
  onClose,
  onSnooze,
}: {
  theme: Theme;
  open: boolean;
  /** The agent being snoozed, for the description line. */
  title: string;
  onClose(): void;
  onSnooze(until: number): void;
}) {
  const [opened] = useState(() => Date.now());
  const defaults = useMemo(() => customSnoozeDefaults(opened), [opened]);
  const [mode, setMode] = useState<CustomSnooze["mode"]>("datetime");
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time);
  const [amount, setAmount] = useState("2");
  const [unit, setUnit] = useState<DurationUnit>("hours");
  const now = Date.now();
  const input: CustomSnooze = mode === "datetime" ? { mode, date, time } : { mode, amount, unit };
  const result = parseCustomSnooze(input, now);
  const until = "until" in result ? result.until : null;

  const styles = useMemo(() => {
    const segment = {
      flex: 1,
      minHeight: 32,
      borderRadius: 7,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    };
    const field = {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      minHeight: 38,
      paddingHorizontal: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface1,
    };
    const button = {
      minHeight: 36,
      paddingHorizontal: 16,
      borderRadius: 8,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    };
    return {
      description: { color: theme.colors.foregroundMuted, fontSize: 13 },
      segments: {
        flexDirection: "row" as const,
        padding: 3,
        gap: 3,
        borderRadius: 9,
        backgroundColor: theme.colors.surface2,
      },
      segment,
      segmentOn: { ...segment, backgroundColor: theme.colors.surface0 },
      segmentText: { color: theme.colors.foregroundMuted, fontSize: 13 },
      segmentTextOn: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      fields: { flexDirection: "row" as const, gap: 12 },
      fieldGroup: { flex: 1, gap: 6 },
      fieldLabel: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      field,
      fieldInput: { flex: 1, color: theme.colors.foreground, fontSize: 14, paddingVertical: 6 },
      units: { flexDirection: "row" as const, gap: 6 },
      unit: { ...field, flex: 1, justifyContent: "center" as const },
      unitOn: {
        ...field,
        flex: 1,
        justifyContent: "center" as const,
        borderColor: theme.colors.accent,
      },
      unitText: { color: theme.colors.foreground, fontSize: 13 },
      summary: { color: theme.colors.foregroundMuted, fontSize: 13 },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
      footer: {
        flexDirection: "row" as const,
        justifyContent: "flex-end" as const,
        gap: 8,
        paddingTop: 4,
      },
      cancel: {
        ...button,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      cancelText: { color: theme.colors.foreground, fontSize: 14 },
      submit: { ...button, backgroundColor: theme.colors.accent },
      submitDisabled: { opacity: 0.45 },
      submitText: {
        color: theme.colors.accentForeground,
        fontSize: 14,
        fontWeight: "600" as const,
      },
    };
  }, [theme]);

  const segmentButton = (id: CustomSnooze["mode"], label: string) => (
    <Pressable
      key={id}
      accessibilityRole="tab"
      accessibilityState={{ selected: mode === id }}
      onPress={() => setMode(id)}
      style={mode === id ? styles.segmentOn : styles.segment}
    >
      <Text style={mode === id ? styles.segmentTextOn : styles.segmentText}>{label}</Text>
    </Pressable>
  );
  const textField = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    placeholder: string,
    icon: string,
    keyboard: "default" | "numeric" | "numbers-and-punctuation",
  ) => (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.field}>
        <TextInput
          style={styles.fieldInput}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.foregroundMuted}
          keyboardType={keyboard}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={label}
        />
        <Icon name={icon} size={16} color={theme.colors.foregroundMuted} />
      </View>
    </View>
  );

  return (
    <Modal title="Custom snooze" open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <Modal.Content>
        <Text style={styles.description} numberOfLines={2}>
          Choose when “{title}” returns to Needs attention.
        </Text>
        <View accessibilityRole="tablist" style={styles.segments}>
          {segmentButton("datetime", "Date and time")}
          {segmentButton("duration", "Duration")}
        </View>
        {mode === "datetime" ? (
          <View style={styles.fields}>
            {textField("Date", date, setDate, "2026-11-04", "Calendar", "numbers-and-punctuation")}
            {textField("Time", time, setTime, "14:30", "Clock", "numbers-and-punctuation")}
          </View>
        ) : (
          <View style={styles.fields}>
            {textField("Amount", amount, setAmount, "2", "Hourglass", "numeric")}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Unit</Text>
              <View style={styles.units}>
                {UNITS.map((option) => (
                  <Pressable
                    key={option.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: unit === option.id }}
                    onPress={() => setUnit(option.id)}
                    style={unit === option.id ? styles.unitOn : styles.unit}
                  >
                    <Text style={styles.unitText}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        )}
        {"error" in result ? (
          <Text style={styles.error}>{result.error}</Text>
        ) : (
          <Text style={styles.summary}>Returns {formatWake(result.until, now)}</Text>
        )}
        <View style={styles.footer}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: until === null }}
            disabled={until === null}
            onPress={() => (until === null ? null : onSnooze(until))}
            style={[styles.submit, until === null && styles.submitDisabled]}
          >
            <Text style={styles.submitText}>Snooze</Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}
