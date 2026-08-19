import {describe, expect, it} from 'vitest';

import {
  accentBorderStyle,
  entityEmbedMinSizeFor,
  entityEmbedSizeFor,
  readableTextColor,
  resolveAccentPropagation,
} from './canvas-node-utils';

describe('entityEmbedSizeFor', () => {
  it('gives every real embeddable type its own size', () => {
    expect(entityEmbedSizeFor('calendar')).toEqual({width: 420, height: 420});
    expect(entityEmbedSizeFor('documents')).toEqual({width: 420, height: 420});
    expect(entityEmbedSizeFor('expenses')).toEqual({width: 420, height: 340});
  });

  it('falls back to a default for anything unrecognized', () => {
    expect(entityEmbedSizeFor('opportunities')).toEqual({width: 420, height: 400});
  });
});

describe('entityEmbedMinSizeFor', () => {
  it('gives every embed a resize floor', () => {
    expect(entityEmbedMinSizeFor('calendar')).toEqual({width: 280, height: 220});
  });
});

describe('resolveAccentPropagation', () => {
  it('paints the target when the source is coloured and the target is not', () => {
    expect(resolveAccentPropagation('teal', null)).toEqual({
      target: 'target',
      color: 'teal',
    });
  });

  it('paints the source when the target is coloured and the source is not', () => {
    expect(resolveAccentPropagation(null, 'pink')).toEqual({
      target: 'source',
      color: 'pink',
    });
  });

  it('does nothing when neither end has a colour', () => {
    expect(resolveAccentPropagation(null, null)).toBeNull();
  });

  it('does nothing when both ends already share one', () => {
    expect(resolveAccentPropagation('teal', 'teal')).toBeNull();
  });

  it('does nothing when the two ends are differently coloured - joining two clusters has no winner', () => {
    expect(resolveAccentPropagation('teal', 'pink')).toBeNull();
  });
});

describe('accentBorderStyle', () => {
  it('uses the accent colour when one is set', () => {
    expect(accentBorderStyle('#0D9488')).toEqual({
      borderColor: '#0D9488',
      borderWidth: 2,
    });
  });

  it('falls back to the default border token when there is none', () => {
    expect(accentBorderStyle(null)).toEqual({borderColor: 'var(--color-border)'});
    expect(accentBorderStyle(undefined)).toEqual({borderColor: 'var(--color-border)'});
  });
});

describe('readableTextColor', () => {
  it('picks white on a dark, saturated fill', () => {
    expect(readableTextColor('#7C3AED')).toBe('#FFFFFF');
  });

  it('picks dark on a pale sticky-note fill', () => {
    expect(readableTextColor('#FDE68A')).toBe('#111827');
  });

  it('expands a 3-digit hex before scoring it', () => {
    expect(readableTextColor('#000')).toBe('#FFFFFF');
    expect(readableTextColor('#FFF')).toBe('#111827');
  });
});
