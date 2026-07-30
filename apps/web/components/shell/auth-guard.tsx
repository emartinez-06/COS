'use client';

/**
 * Gates the dashboard on a real session.
 *
 * This is a routing convenience, not a security control - it decides what to
 * render, and nothing more. The data behind these screens is protected by the
 * API, which checks the session cookie and the caller's capability on every
 * request regardless of what the browser believes.
 *
 * The four states are kept distinct on purpose. "Still checking", "signed
 * out", "the API is unreachable", and "signed in but in no club" need
 * different words on screen; collapsing them produces the classic bug where a
 * backend outage looks like being logged out.
 */

import {useEffect} from 'react';
import type {CSSProperties} from 'react';
import {useRouter} from 'next/navigation';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Center} from '@astryxdesign/core/Center';
import {VStack} from '@astryxdesign/core/Layout';
import {Spinner} from '@astryxdesign/core/Spinner';
import {Text, Heading} from '@astryxdesign/core/Text';

import {useSession} from '../../lib/session';

const fullPage: CSSProperties = {
  minHeight: '100dvh',
  backgroundColor: 'var(--color-background-body)',
  padding: 'var(--spacing-6)',
};

const messageWidth: CSSProperties = {
  width: '100%',
  maxWidth: 440,
};

export function AuthGuard({children}: {children: React.ReactNode}) {
  const router = useRouter();
  const {status, memberships, refresh} = useSession();

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status === 'loading' || status === 'anonymous') {
    // Anonymous renders the spinner too, rather than a flash of the login
    // prompt, because the redirect above is already on its way.
    return (
      <Center axis="both" style={fullPage}>
        <Spinner size="lg" label="Loading your session" />
      </Center>
    );
  }

  if (status === 'error') {
    return (
      <Center axis="both" style={fullPage}>
        <Card padding={8} style={messageWidth}>
          <VStack gap={4} hAlign="stretch">
            <VStack gap={1}>
              <Heading level={2}>Cannot reach the server</Heading>
              <Text type="body" color="secondary">
                Your session could not be loaded. The API may not be running.
              </Text>
            </VStack>
            <Button
              label="Try again"
              variant="primary"
              onClick={() => void refresh()}
            />
          </VStack>
        </Card>
      </Center>
    );
  }

  if (memberships.length === 0) {
    return (
      <Center axis="both" style={fullPage}>
        <Card padding={8} style={messageWidth}>
          <VStack gap={2}>
            <Heading level={2}>You are not in a club yet</Heading>
            <Text type="body" color="secondary">
              COS shows the calendar for the clubs you belong to. Ask an
              officer to invite you, and this page will fill in.
            </Text>
          </VStack>
        </Card>
      </Center>
    );
  }

  return <>{children}</>;
}
