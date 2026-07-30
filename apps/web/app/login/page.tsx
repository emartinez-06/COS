'use client';

/**
 * Sign in.
 *
 * Composed from Astryx's `login-card` template, minus the social providers -
 * there are none configured, and a dead "Continue with Google" button is worse
 * than no button. University SSO is the one that will actually go here, and it
 * is still an open question (docs/OPEN-QUESTIONS.md).
 */

import {Suspense, useEffect, useState} from 'react';
import type {CSSProperties} from 'react';
import {useRouter, useSearchParams} from 'next/navigation';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Center} from '@astryxdesign/core/Center';
import {Icon} from '@astryxdesign/core/Icon';
import {VStack} from '@astryxdesign/core/Layout';
import {Link} from '@astryxdesign/core/Link';
import {Spinner} from '@astryxdesign/core/Spinner';
import {Text, Heading} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {CalendarDaysIcon} from '@heroicons/react/24/solid';

import {signIn} from '../../lib/auth-client';
import {useSession} from '../../lib/session';

// Standalone auth page: no AppShell here, so it paints its own background.
const pageStyle: CSSProperties = {
  minHeight: '100dvh',
  backgroundColor: 'var(--color-background-body)',
  padding: 'var(--spacing-6)',
};

// Stack has no maxWidth prop, so the column cap lives here.
const contentStyle: CSSProperties = {
  width: '100%',
  maxWidth: 400,
};

/**
 * Which field an error belongs to, so it renders under that field rather than
 * under whichever input happens to be last. A rejected sign-in is `form`: it
 * is not the email's fault or the password's, and saying which it was would
 * tell an attacker whether the account exists.
 */
type ErrorField = 'email' | 'password' | 'form';

interface FormError {
  field: ErrorField;
  message: string;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {status, refresh} = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<FormError | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const nextPath = searchParams.get('next') ?? '/';

  // Someone who is already signed in has no business on the login screen.
  useEffect(() => {
    if (status === 'authenticated') {
      router.replace(nextPath);
    }
  }, [status, router, nextPath]);

  /** The status prop for one field, set only when the error is about it. */
  const statusFor = (field: ErrorField) =>
    error?.field === field
      ? ({type: 'error', message: error.message} as const)
      : undefined;

  const handleSubmit = async () => {
    if (!email) {
      setError({field: 'email', message: 'Enter your email.'});
      return;
    }
    if (!password) {
      setError({field: 'password', message: 'Enter your password.'});
      return;
    }

    setIsLoading(true);
    setError(null);

    const {error: signInError} = await signIn.email({email, password});

    if (signInError) {
      // Deliberately does not distinguish "no such account" from "wrong
      // password": that difference tells an attacker which emails are
      // registered. For the same reason it is a form-level error rather than
      // one pinned to the email or the password field.
      setError({
        field: 'form',
        message: 'That email and password do not match an account.',
      });
      setIsLoading(false);
      return;
    }

    // Pull the memberships before navigating, so the dashboard renders with a
    // known role rather than flashing the member view at an officer.
    await refresh();
    router.replace(nextPath);
  };

  return (
    <Center axis="both" style={pageStyle}>
      <VStack gap={4} hAlign="center" style={contentStyle}>
        <VStack gap={2} hAlign="center">
          <Icon icon={CalendarDaysIcon} size="lg" />
          <Text type="body" weight="bold" size="lg">
            COS
          </Text>
        </VStack>

        <Card padding={8} width="100%">
          <VStack gap={4} hAlign="stretch">
            <VStack gap={1} hAlign="center">
              <Heading level={2}>Welcome back</Heading>
              <Text type="body" color="secondary" size="sm">
                Sign in to your club calendar
              </Text>
            </VStack>

            {error?.field === 'form' && (
              <Banner status="error" title={error.message} />
            )}

            <VStack gap={2}>
              <TextInput
                label="Email"
                isLabelHidden
                type="email"
                placeholder="name@university.edu"
                value={email}
                onChange={(value: string) => {
                  setEmail(value);
                  setError(null);
                }}
                size="lg"
                status={statusFor('email')}
              />
              <TextInput
                label="Password"
                isLabelHidden
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(value: string) => {
                  setPassword(value);
                  setError(null);
                }}
                size="lg"
                status={statusFor('password')}
              />
            </VStack>

            <Button
              label="Sign in"
              variant="primary"
              size="lg"
              isLoading={isLoading}
              onClick={() => void handleSubmit()}
            />

            <VStack hAlign="center">
              <Text type="supporting" color="secondary">
                New here?{' '}
                <Link href="/signup" type="supporting">
                  Create an account
                </Link>
              </Text>
            </VStack>
          </VStack>
        </Card>
      </VStack>
    </Center>
  );
}

/**
 * `useSearchParams` opts the route out of static prerendering unless it sits
 * under a Suspense boundary, so the form is split out and the fallback is the
 * same spinner the dashboard uses while its session resolves.
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <Center axis="both" style={pageStyle}>
          <Spinner size="lg" label="Loading" />
        </Center>
      }>
      <LoginForm />
    </Suspense>
  );
}
