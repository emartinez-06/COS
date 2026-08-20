'use client';

/**
 * Land here from a join link - the only page in the product nobody needs an
 * account to open. It answers three different situations with the same URL:
 *
 * - The token is dead (never existed, expired, revoked): say so, offer the
 *   ordinary sign-up/sign-in doors instead.
 * - The visitor already has a session: one click joins them, no form.
 * - The visitor has no session: the sign-up form lives right here rather
 *   than bouncing to `/signup` and losing the token, because the whole point
 *   of a join link is "one link, no second step".
 *
 * Signing up and joining are two API calls, not one - `signUp.email` is
 * better-auth's own endpoint and knows nothing about club membership. They
 * are chained here so the visitor experiences them as a single action.
 */

import {useCallback, useEffect, useState} from 'react';
import type {CSSProperties} from 'react';
import {useParams, useRouter} from 'next/navigation';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Center} from '@astryxdesign/core/Center';
import {Icon} from '@astryxdesign/core/Icon';
import {Spinner} from '@astryxdesign/core/Spinner';
import {VStack} from '@astryxdesign/core/Stack';
import {Link} from '@astryxdesign/core/Link';
import {Text, Heading} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {UserGroupIcon} from '@heroicons/react/24/solid';
import type {JoinLinkPreview} from '@cos/core';
import {memberTitle} from '@cos/core';

import {signUp} from '../../../lib/auth-client';
import {acceptJoinLink, previewJoinLink} from '../../../lib/join-link-client';
import {useSession} from '../../../lib/session';

const MIN_PASSWORD_LENGTH = 12;

const pageStyle: CSSProperties = {
  minHeight: '100dvh',
  backgroundColor: 'var(--color-background-body)',
  padding: 'var(--spacing-6)',
};

const contentStyle: CSSProperties = {
  width: '100%',
  maxWidth: 400,
};

type ErrorField = 'name' | 'email' | 'password' | 'form';

interface FormError {
  field: ErrorField;
  message: string;
}

export default function JoinLinkPage() {
  const params = useParams<{token: string}>();
  const token = params.token;
  const router = useRouter();
  const {status, refresh} = useSession();

  const [preview, setPreview] = useState<JoinLinkPreview | null | 'loading'>(
    'loading',
  );

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<FormError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void previewJoinLink(token).then((result) => {
      if (!cancelled) {
        setPreview(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const joinAsSignedInUser = useCallback(async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await acceptJoinLink(token);
      await refresh();
      router.replace('/home');
    } catch (cause) {
      setError({
        field: 'form',
        message:
          cause instanceof Error
            ? cause.message
            : 'Could not join. The link may have just expired.',
      });
      setIsSubmitting(false);
    }
  }, [token, refresh, router]);

  const statusFor = (field: ErrorField) =>
    error?.field === field
      ? ({type: 'error', message: error.message} as const)
      : undefined;

  async function submitSignUp() {
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

    setIsSubmitting(true);
    setError(null);

    const {error: signUpError} = await signUp.email({
      name: name.trim(),
      email,
      password,
    });

    if (signUpError) {
      setError({
        field: 'form',
        message: signUpError.message ?? 'Could not create that account.',
      });
      setIsSubmitting(false);
      return;
    }

    try {
      await acceptJoinLink(token);
      await refresh();
      router.replace('/home');
    } catch (cause) {
      // The account exists at this point even though joining failed - most
      // likely the link expired in the seconds it took to fill the form.
      setError({
        field: 'form',
        message:
          cause instanceof Error
            ? cause.message
            : 'Your account was created, but this link is no longer valid.',
      });
      setIsSubmitting(false);
    }
  }

  const grantLabel = preview && preview !== 'loading'
    ? memberTitle(preview.role, preview.position)
    : null;

  return (
    <Center axis="both" style={pageStyle}>
      <VStack gap={4} hAlign="center" style={contentStyle}>
        <VStack gap={2} hAlign="center">
          <Icon icon={UserGroupIcon} size="lg" />
          <Text type="body" weight="bold" size="lg">
            COS
          </Text>
        </VStack>

        <Card padding={8} width="100%">
          {preview === 'loading' ? (
            <Center axis="both">
              <Spinner size="lg" label="Loading" />
            </Center>
          ) : preview === null ? (
            <VStack gap={4} hAlign="stretch">
              <VStack gap={1} hAlign="center">
                <Heading level={2}>This link isn&apos;t valid</Heading>
                <Text type="body" color="secondary" size="sm">
                  It may have expired or been turned off. Ask whoever shared it
                  for a new one.
                </Text>
              </VStack>
              <VStack hAlign="center">
                <Text type="supporting" color="secondary">
                  Already have an account?{' '}
                  <Link href="/login" type="supporting">
                    Sign in
                  </Link>
                </Text>
              </VStack>
            </VStack>
          ) : status === 'authenticated' ? (
            <VStack gap={4} hAlign="stretch">
              <VStack gap={1} hAlign="center">
                <Heading level={2}>Join {preview.clubName}</Heading>
                <Text type="body" color="secondary" size="sm">
                  You&apos;ll join as {grantLabel}.
                </Text>
              </VStack>

              {error?.field === 'form' && (
                <Banner status="error" title={error.message} />
              )}

              <Button
                label="Join"
                variant="primary"
                size="lg"
                isLoading={isSubmitting}
                onClick={() => void joinAsSignedInUser()}
              />
            </VStack>
          ) : (
            <VStack gap={4} hAlign="stretch">
              <VStack gap={1} hAlign="center">
                <Heading level={2}>Join {preview.clubName}</Heading>
                <Text type="body" color="secondary" size="sm">
                  Create an account to join as {grantLabel}.
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
                label="Create account and join"
                variant="primary"
                size="lg"
                isLoading={isSubmitting}
                onClick={() => void submitSignUp()}
              />

              <VStack hAlign="center">
                <Text type="supporting" color="secondary">
                  Already have an account?{' '}
                  <Link href={`/login?next=/join/${token}`} type="supporting">
                    Sign in
                  </Link>
                </Text>
              </VStack>
            </VStack>
          )}
        </Card>
      </VStack>
    </Center>
  );
}
