import { describe, expect, it } from 'vitest';
import { resolveRedirect } from '../../lib/onboarding/redirect';

describe('resolveRedirect', () => {
  it('sends a signed-out person hitting a protected route to /login', () => {
    expect(
      resolveRedirect({ isSignedIn: false, topicCount: 0, pathname: '/' }),
    ).toBe('/login');
    expect(
      resolveRedirect({
        isSignedIn: false,
        topicCount: 0,
        pathname: '/onboarding',
      }),
    ).toBe('/login');
  });

  it('lets a signed-out person through to /login itself', () => {
    expect(
      resolveRedirect({ isSignedIn: false, topicCount: 0, pathname: '/login' }),
    ).toBeNull();
  });

  it('lets a signed-out person through to /auth/callback (mid-OAuth-exchange)', () => {
    expect(
      resolveRedirect({
        isSignedIn: false,
        topicCount: 0,
        pathname: '/auth/callback',
      }),
    ).toBeNull();
  });

  it('lets a signed-in person with zero topics through to /onboarding', () => {
    expect(
      resolveRedirect({
        isSignedIn: true,
        topicCount: 0,
        pathname: '/onboarding',
      }),
    ).toBeNull();
  });

  it('lets a signed-in person with zero topics through to /auth/callback', () => {
    expect(
      resolveRedirect({
        isSignedIn: true,
        topicCount: 0,
        pathname: '/auth/callback',
      }),
    ).toBeNull();
  });

  it('sends a signed-in person with zero topics anywhere else to /onboarding', () => {
    expect(
      resolveRedirect({ isSignedIn: true, topicCount: 0, pathname: '/' }),
    ).toBe('/onboarding');
    expect(
      resolveRedirect({ isSignedIn: true, topicCount: 0, pathname: '/login' }),
    ).toBe('/onboarding');
  });

  it('sends a signed-in person with topics away from /onboarding', () => {
    expect(
      resolveRedirect({
        isSignedIn: true,
        topicCount: 3,
        pathname: '/onboarding',
      }),
    ).toBe('/');
  });

  it('lets a signed-in person with topics through everywhere else', () => {
    expect(
      resolveRedirect({ isSignedIn: true, topicCount: 1, pathname: '/' }),
    ).toBeNull();
    expect(
      resolveRedirect({ isSignedIn: true, topicCount: 1, pathname: '/login' }),
    ).toBeNull();
  });

  it('treats exactly one topic the same as many (boundary check)', () => {
    expect(
      resolveRedirect({
        isSignedIn: true,
        topicCount: 1,
        pathname: '/onboarding',
      }),
    ).toBe('/');
  });
});
