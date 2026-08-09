'use client';

/**
 * Rebinding the search shortcut.
 *
 * The recorder listens for one real keystroke rather than asking someone to
 * type "alt+s" into a text field. A field would accept `ctrl+shfit+k`, and the
 * only feedback would be a shortcut that never fires again.
 *
 * Cmd/Ctrl+K is shown here too, as a fixed row with no control beside it. It
 * cannot be rebound and saying so is the point: someone who binds this to
 * something they then forget still has a way in, and a settings screen that
 * listed only the changeable half would hide that.
 */

import {useEffect, useState, type CSSProperties} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Divider} from '@astryxdesign/core/Divider';
import {Kbd} from '@astryxdesign/core/Kbd';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';

import {
  captureComboFromEvent,
  formatShortcutLabel,
  searchShortcutStore,
  toKbdKeys,
} from '../../lib/shortcut-store';

const rowPadding: CSSProperties = {paddingBlock: 'var(--spacing-3)'};

export function ShortcutsSection() {
  /**
   * Starts on the default for both the server pass and the first client
   * render, then syncs. Reading localStorage in the initialiser would make the
   * two disagree and trip a hydration mismatch.
   */
  const [combo, setCombo] = useState(searchShortcutStore.DEFAULT_SHORTCUT);
  const [isRecording, setRecording] = useState(false);

  useEffect(() => {
    setCombo(searchShortcutStore.getShortcut());
  }, []);

  useEffect(() => {
    if (!isRecording) {
      return;
    }

    const onKey = (event: KeyboardEvent) => {
      // Swallow everything while recording, so capturing Cmd+S does not also
      // open the browser's save dialog.
      event.preventDefault();

      if (event.key === 'Escape') {
        setRecording(false);
        return;
      }

      const captured = captureComboFromEvent(event);
      if (!captured) {
        // A bare modifier, or a key with none. Keep listening.
        return;
      }

      searchShortcutStore.setShortcut(captured);
      setCombo(captured);
      setRecording(false);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isRecording]);

  const isCustom = combo !== searchShortcutStore.DEFAULT_SHORTCUT;

  return (
    <VStack gap={5} hAlign="stretch">
      <VStack gap={1}>
        <Heading level={2}>Keyboard shortcuts</Heading>
        <Text type="body" color="secondary">
          How you open search from anywhere in COS.
        </Text>
      </VStack>

      <Card padding={6}>
        <VStack gap={0} hAlign="stretch">
          <HStack hAlign="between" vAlign="center" style={rowPadding} gap={3}>
            <VStack gap={0}>
              <Text type="body" weight="semibold">
                Open search
              </Text>
              <Text type="supporting" color="secondary">
                {isRecording
                  ? 'Press the combination you want. Escape cancels.'
                  : 'Your own combination. It must include a modifier key.'}
              </Text>
            </VStack>

            <HStack gap={2} vAlign="center">
              {isRecording ? (
                <Text type="body" color="secondary">
                  Listening...
                </Text>
              ) : (
                <Kbd keys={toKbdKeys(combo)} />
              )}
              <Button
                label={isRecording ? 'Cancel' : 'Record new shortcut'}
                variant="secondary"
                size="sm"
                onClick={() => setRecording((recording) => !recording)}
              />
              {isCustom && !isRecording ? (
                <Button
                  label="Reset"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    searchShortcutStore.resetShortcut();
                    setCombo(searchShortcutStore.DEFAULT_SHORTCUT);
                  }}
                />
              ) : null}
            </HStack>
          </HStack>

          <Divider />

          <HStack hAlign="between" vAlign="center" style={rowPadding} gap={3}>
            <VStack gap={0}>
              <Text type="body" weight="semibold">
                Open search (always available)
              </Text>
              <Text type="supporting" color="secondary">
                Fixed, so there is always a way in.
              </Text>
            </VStack>
            <Kbd keys="mod+k" />
          </HStack>
        </VStack>
      </Card>

      <Text type="supporting" color="secondary">
        Saved on this device only, not to your account
        {isCustom ? `. Currently ${formatShortcutLabel(combo)}` : ''}.
      </Text>
    </VStack>
  );
}
