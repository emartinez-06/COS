import {describe, expect, it} from 'vitest';

import {
  ALL_CAPABILITIES,
  ROLE_LABELS,
  STATEMENT,
  can,
  capabilitiesFor,
  capabilitySchema,
  roleSchema,
} from './role.js';
import type {Capability, Role} from './role.js';

const ROLES: readonly Role[] = ['admin', 'member'];

describe('STATEMENT', () => {
  it('flattens into every resource:action pair', () => {
    expect([...ALL_CAPABILITIES].sort()).toEqual(
      [
        'announcement:draft',
        'event:create',
        'event:delete',
        'event:edit',
        'event:view',
      ].sort(),
    );
  });

  it('declares no resource without actions', () => {
    for (const [resource, actions] of Object.entries(STATEMENT)) {
      expect(actions.length, `${resource} has no actions`).toBeGreaterThan(0);
    }
  });

  it('declares no duplicate capabilities', () => {
    expect(new Set(ALL_CAPABILITIES).size).toBe(ALL_CAPABILITIES.length);
  });
});

describe('can', () => {
  it('lets an officer run the club', () => {
    expect(can('admin', 'event:create')).toBe(true);
    expect(can('admin', 'event:edit')).toBe(true);
    expect(can('admin', 'event:delete')).toBe(true);
    expect(can('admin', 'announcement:draft')).toBe(true);
  });

  it('lets a member see events but change nothing', () => {
    expect(can('member', 'event:view')).toBe(true);
    expect(can('member', 'event:create')).toBe(false);
    expect(can('member', 'event:edit')).toBe(false);
    expect(can('member', 'event:delete')).toBe(false);
  });

  it('does not let a member draft announcements to the whole group', () => {
    expect(can('member', 'announcement:draft')).toBe(false);
  });

  it('lets every role view events, since that is the read surface', () => {
    for (const role of ROLES) {
      expect(can(role, 'event:view'), role).toBe(true);
    }
  });

  it('grants nothing outside the statement', () => {
    for (const role of ROLES) {
      for (const capability of capabilitiesFor(role)) {
        expect(ALL_CAPABILITIES).toContain(capability);
      }
    }
  });

  it('agrees with capabilitiesFor', () => {
    for (const role of ROLES) {
      const held = capabilitiesFor(role);
      for (const capability of ALL_CAPABILITIES) {
        expect(can(role, capability), `${role} / ${capability}`).toBe(
          held.includes(capability),
        );
      }
    }
  });

  it('is a pure lookup that never mutates the grant list', () => {
    const before = [...capabilitiesFor('member')];
    can('member', 'event:create');
    can('member', 'event:view');
    expect([...capabilitiesFor('member')]).toEqual(before);
  });
});

describe('schemas', () => {
  it('accepts the roles the product defines and rejects invented ones', () => {
    for (const role of ROLES) {
      expect(roleSchema.parse(role)).toBe(role);
    }
    expect(roleSchema.safeParse('owner').success).toBe(false);
    expect(roleSchema.safeParse('').success).toBe(false);
  });

  it('validates capabilities coming off the wire', () => {
    expect(capabilitySchema.parse('event:create')).toBe('event:create');
    expect(capabilitySchema.safeParse('event:destroy').success).toBe(false);
    expect(capabilitySchema.safeParse('treasury:withdraw').success).toBe(false);
  });

  it('covers every capability in the statement', () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(capabilitySchema.safeParse(capability).success, capability).toBe(
        true,
      );
    }
  });
});

describe('ROLE_LABELS', () => {
  it('gives every role a human label, since the UI renders these', () => {
    for (const role of ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it('calls an admin an Officer, which is the word clubs actually use', () => {
    expect(ROLE_LABELS.admin).toBe('Officer');
  });
});

describe('capability typing', () => {
  it('derives the union from STATEMENT', () => {
    // Compile-time assertion: these must be assignable to Capability.
    const valid: Capability[] = ['event:create', 'announcement:draft'];
    expect(valid).toHaveLength(2);

    // @ts-expect-error 'event:archive' is not an action in STATEMENT
    const invalid: Capability = 'event:archive';
    expect(invalid).toBe('event:archive');
  });
});
