'use client';

/**
 * Create an account.
 *
 * Sign-up exists because otherwise the only accounts are the two the seed
 * script creates. A new account belongs to no club yet - joining one is the
 * invitation flow, which is on the backlog - so the dashboard tells them so
 * rather than pretending they have a calendar.
 *
 * The 12-character minimum matches `minPasswordLength` in the API. Stating it
 * up front beats letting the server reject the form.
 */

import {useEffect, useState} from 'react';
import type {CSSProperties} from 'react';
import {useRouter} from 'next/navigation';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Center} from '@astryxdesign/core/Center';
import {Icon} from '@astryxdesign/core/Icon';
import {VStack} from '@astryxdesign/core/Layout';
import {Link} from '@astryxdesign/core/Link';
import {Text, Heading} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {CalendarDaysIcon} from '@heroicons/react/24/solid';

import {signUp} from '../../lib/auth-client';
import {useSession} from '../../lib/session';

const MIN_PASSWORD_LENGTH = 12;

/**
 * Which field an error belongs to, so it renders under that field rather than
 * under whichever input happens to be last. `form` is for failures that are
 * not about one field - a rejected sign-up, usually.
 */
type ErrorField = 'name' | 'email' | 'password' | 'form';

interface FormError {
  field: ErrorField;
  message: string;
}

const pageStyle: CSSProperties = {
  minHeight: '100dvh',
  backgroundColor: 'var(--color-background-body)',
  padding: 'var(--spacing-6)',
};

const contentStyle: CSSProperties = {
  width: '100%',
  maxWidth: 400,
};

export default function SignUpPage() {
  const router = useRouter();
  const {status, refresh} = useSession();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<FormError | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/');
    }
  }, [status, router]);

  /** The status prop for one field, set only when the error is about it. */
  const statusFor = (field: ErrorField) =>
    error?.field === field
      ? ({type: 'error', message: error.message} as const)
      : undefined;

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError({field: 'name', message: 'Enter your name.'});
      return;
    }
    if (!email) {
      setError({field: 'email', message: 'Enter your email.'});
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError({
        field: 'password',
        message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
      return;
    }

    setIsLoading(true);
    setError(null);

    const {error: signUpError} = await signUp.email({
      name: name.trim(),
      email,
      password,
    });

    if (signUpError) {
      // Server-side failures are usually about the account as a whole - an
      // email already registered - so they belong to the form, not a field.
      setError({
        field: 'form',
        message: signUpError.message ?? 'Could not create that account.',
      });
      setIsLoading(false);
      return;
    }

    await refresh();
    router.replace('/');
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
              <Heading level={2}>Create your account</Heading>
              <Text type="body" color="secondary" size="sm">
                One account, every club you are in
              </Text>
            </VStack>

            {error?.field === 'form' && (
              <Banner status="error" title={error.message} />
            )}

            <VStack gap={2}>
              <TextInput
                label="Name"
                isLabelHidden
                placeholder="Your name"
                value={name}
                onChange={(value: string) => {
                  setName(value);
                  setError(null);
                }}
                size="lg"
                status={statusFor('name')}
              />
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
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
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
              label="Create account"
              variant="primary"
              size="lg"
              isLoading={isLoading}
              onClick={() => void handleSubmit()}
            />

            <VStack hAlign="center">
              <Text type="supporting" color="secondary">
                Already have an account?{' '}
                <Link href="/login" type="supporting">
                  Sign in
                </Link>
              </Text>
            </VStack>
          </VStack>
        </Card>
      </VStack>
    </Center>
  );
}
