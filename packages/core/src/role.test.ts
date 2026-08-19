import {describe, expect, it} from 'vitest';

import {
  ALL_CAPABILITIES,
  ALL_POSITIONS,
  DEFAULT_PRESENCE_COLOR,
  POSITION_COLORS,
  POSITION_LABELS,
  ROLE_LABELS,
  STATEMENT,
  can,
  capabilitiesFor,
  capabilitySchema,
  memberTitle,
  positionSchema,
  roleSchema,
} from './role.js';
import type {Capability, Position, Role} from './role.js';

const ROLES: readonly Role[] = ['admin', 'member'];

describe('STATEMENT', () => {
  it('flattens into every resource:action pair', () => {
    expect([...ALL_CAPABILITIES].sort()).toEqual(
      [
        'announcement:draft',
        'canvas:create',
        'canvas:delete',
        'canvas:edit',
        'canvas:view',
        'document:create',
        'document:delete',
        'document:edit',
        'document:view',
        'event:create',
        'event:delete',
        'event:edit',
        'event:view',
        'expense:create',
        'expense:delete',
        'expense:edit',
        'expense:view',
        'member:invite',
        'member:remove',
        'member:view',
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

describe('the treasury is officer-only', () => {
  it('lets an officer do everything with an expense', () => {
    expect(can('admin', 'expense:view')).toBe(true);
    expect(can('admin', 'expense:create')).toBe(true);
    expect(can('admin', 'expense:edit')).toBe(true);
    expect(can('admin', 'expense:delete')).toBe(true);
  });

  it('refuses a member every expense capability, including read', () => {
    // Read is denied too, not just writes. A club's spending is not something
    // the whole roster browses, and `expense:view` is what hides the section.
    expect(can('member', 'expense:view')).toBe(false);
    expect(can('member', 'expense:create')).toBe(false);
    expect(can('member', 'expense:edit')).toBe(false);
    expect(can('member', 'expense:delete')).toBe(false);
  });

  it('leaves a member with exactly the capabilities they are meant to have', () => {
    // Guards against a grant leaking sideways when a resource is added. It has
    // already earned its keep once: adding the document hub made this fail,
    // which is the point - `document:view` is a deliberate widening of what a
    // member may do, and it had to be stated here to land.
    expect([...capabilitiesFor('member')].sort()).toEqual(
      ['event:view', 'member:view', 'document:view'].sort(),
    );
  });
});

describe('inviting is an officer capability, not a presidential one', () => {
  it('lets any officer invite and remove, regardless of position', () => {
    // The point: a club whose president has gone quiet still needs its
    // treasurer able to add a member. Tying this to a title would be the one
    // place a position starts granting something.
    expect(can('admin', 'member:invite')).toBe(true);
    expect(can('admin', 'member:remove')).toBe(true);
  });

  it('refuses a member the ability to invite or remove anyone', () => {
    expect(can('member', 'member:invite')).toBe(false);
    expect(can('member', 'member:remove')).toBe(false);
  });

  it('lets a member see the roster, because a club is not a secret', () => {
    expect(can('member', 'member:view')).toBe(true);
  });
});

describe('positions', () => {
  it('gives every position a human label, since the UI renders these', () => {
    for (const position of ALL_POSITIONS) {
      expect(POSITION_LABELS[position], position).toBeTruthy();
    }
  });

  it('validates positions coming off the wire', () => {
    expect(positionSchema.parse('treasurer')).toBe('treasurer');
    expect(positionSchema.safeParse('rush_chair').success).toBe(false);
    expect(positionSchema.safeParse('admin').success).toBe(false);
  });

  it('does not let a position change what anyone may do', () => {
    // The load-bearing property of this whole design. `can` takes a role and
    // nothing else, so no position can widen or narrow access. If this ever
    // needs to change, it is a redesign and not a tweak.
    const officerCapabilities = [...capabilitiesFor('admin')];
    for (const position of ALL_POSITIONS) {
      expect(POSITION_LABELS[position]).toBeTruthy();
      // Same role, same answer, regardless of which title is held.
      expect([...capabilitiesFor('admin')]).toEqual(officerCapabilities);
    }
  });

  it('prefers the specific title over the generic one', () => {
    expect(memberTitle('admin', 'treasurer')).toBe('Treasurer');
    expect(memberTitle('admin', 'marketing_director')).toBe(
      'Marketing Director',
    );
  });

  it('falls back to the role when no position is set', () => {
    expect(memberTitle('admin', null)).toBe('Officer');
    expect(memberTitle('admin')).toBe('Officer');
    expect(memberTitle('member', null)).toBe('Member');
  });

  it('never labels a plain member with an officer title', () => {
    // A member has no position; if one is ever stored, the role still decides
    // what they may do, so the title must not imply authority they lack.
    const position: Position = 'president';
    expect(can('member', 'expense:view')).toBe(false);
    expect(memberTitle('member', position)).toBe('President');
  });

  it('gives every position a colour, since the canvas presence tag renders these', () => {
    for (const position of ALL_POSITIONS) {
      expect(POSITION_COLORS[position], position).toBeTruthy();
    }
  });

  it('gives every position a distinct colour', () => {
    const colors = ALL_POSITIONS.map((position) => POSITION_COLORS[position]);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('gives a no-position officer a fallback colour distinct from every named position', () => {
    expect(DEFAULT_PRESENCE_COLOR).toBeTruthy();
    expect(Object.values(POSITION_COLORS)).not.toContain(
      DEFAULT_PRESENCE_COLOR,
    );
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
