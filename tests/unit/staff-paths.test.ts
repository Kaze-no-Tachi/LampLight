import { describe, expect, it } from 'vitest';
import { isStaffPath } from '@/lib/staff-paths';

/**
 * Which chrome a screen wears is decided by this one predicate, so the cases
 * worth pinning down are the ones where getting it wrong is invisible: a staff
 * screen with no sidebar has no navigation at all, and a student screen that
 * matched here would lose its header.
 */
describe('isStaffPath', () => {
  it('claims the staff areas and everything under them', () => {
    expect(isStaffPath('/teach')).toBe(true);
    expect(isStaffPath('/teach/courses/abc')).toBe(true);
    expect(isStaffPath('/teach/lessons/abc')).toBe(true);
    expect(isStaffPath('/settings')).toBe(true);
    expect(isStaffPath('/settings/people')).toBe(true);
    expect(isStaffPath('/settings/branding')).toBe(true);
  });

  it('leaves the student surfaces alone', () => {
    expect(isStaffPath('/')).toBe(false);
    expect(isStaffPath('/catalogue')).toBe(false);
    expect(isStaffPath('/catalogue/old-testament-survey')).toBe(false);
    expect(isStaffPath('/courses')).toBe(false);
    expect(isStaffPath('/lessons/abc')).toBe(false);
    expect(isStaffPath('/sign-in')).toBe(false);
  });

  it('leaves /account alone, which belongs to the person not the job', () => {
    // An ordinary student has this page too, and it is reached from both
    // chromes, so it cannot belong to the staff shell.
    expect(isStaffPath('/account')).toBe(false);
  });

  it('ignores the query string the middleware forwards with the path', () => {
    // x-lamplight-path carries the search string, because the canonical-domain
    // redirect must not drop a token. It is not part of this decision.
    expect(isStaffPath('/settings?next=/x')).toBe(true);
    expect(isStaffPath('/teach?filter=draft')).toBe(true);
    expect(isStaffPath('/catalogue?q=/teach')).toBe(false);
  });

  it('does not match a path that merely starts with the same letters', () => {
    // The prefix test is on path segments, so these are other screens and not
    // staff ones, however similar they read.
    expect(isStaffPath('/teaching-notes')).toBe(false);
    expect(isStaffPath('/settings-export')).toBe(false);
  });

  it('treats a missing header as not staff', () => {
    // Failing to the student header is the safe direction: it is the chrome a
    // signed-out visitor should see, and the staff pages are gated anyway.
    expect(isStaffPath(null)).toBe(false);
    expect(isStaffPath(undefined)).toBe(false);
    expect(isStaffPath('')).toBe(false);
  });
});
