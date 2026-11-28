import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** A screen with its title, padded and scrolling, on the theme's background. */
export function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" className="text-h1 font-semibold text-text">
          {title}
        </Text>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <Text className={`text-body-phone ${muted ? 'text-text-muted' : 'text-text'}`}>{children}</Text>
  );
}

/** A message the person must read: a refusal, or why they were signed out. */
export function Notice({
  children,
  tone = 'danger',
}: {
  children: ReactNode;
  tone?: 'danger' | 'info';
}) {
  return (
    <View
      accessibilityRole="alert"
      className={`rounded-md p-3 ${tone === 'danger' ? 'bg-danger-soft' : 'bg-info-soft'}`}
    >
      <Text className={`text-body-phone ${tone === 'danger' ? 'text-danger' : 'text-info'}`}>
        {children}
      </Text>
    </View>
  );
}

interface FieldProps extends Omit<TextInputProps, 'className'> {
  label: string;
  hint?: string;
}

/** A labelled box; the label names it for TalkBack. */
export function Field({ label, hint, ...input }: FieldProps) {
  return (
    <View className="gap-2">
      <Text className="text-body-phone font-medium text-text">{label}</Text>
      {hint === undefined ? null : <Text className="text-caption text-text-muted">{hint}</Text>}
      <TextInput
        accessibilityLabel={label}
        className="min-h-control rounded-md border border-border-strong bg-surface px-3 text-body-phone text-text"
        {...input}
      />
    </View>
  );
}

export function Button({
  label,
  onPress,
  pending = false,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  pending?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: pending, disabled: pending }}
      disabled={pending}
      onPress={onPress}
      className={`min-h-control flex-row items-center justify-center gap-2 rounded-md px-4 ${
        primary ? 'bg-accent' : 'border border-border-strong bg-surface'
      }`}
    >
      {pending ? <ActivityIndicator /> : null}
      <Text className={`text-body-phone font-medium ${primary ? 'text-accent-fg' : 'text-text'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
