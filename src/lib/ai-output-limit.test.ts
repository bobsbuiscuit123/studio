import { describe, expect, it } from 'vitest';

import { clampAiOutputChars, countAiOutputChars } from './ai-output-limit';

describe('ai output limit', () => {
  it('counts nested string characters only', () => {
    expect(
      countAiOutputChars({
        subject: 'Hello',
        body: 'World',
        slides: [{ title: 'A', content: 'BC' }],
        count: 2,
        enabled: true,
      })
    ).toBe(13);
  });

  it('clamps nested output to the total character budget', () => {
    const clamped = clampAiOutputChars(
      {
        subject: 'Hello',
        body: 'World',
        slides: [{ title: 'ABC', content: 'DEF' }],
      },
      10
    );

    expect(clamped).toEqual({
      subject: 'Hello',
      body: 'World',
      slides: [{ title: '', content: '' }],
    });
    expect(countAiOutputChars(clamped)).toBeLessThanOrEqual(10);
  });

  it('clips across arrays in traversal order', () => {
    const clamped = clampAiOutputChars(
      {
        questions: [
          { prompt: 'First question', description: 'Alpha' },
          { prompt: 'Second question', description: 'Beta' },
        ],
      },
      18
    );

    expect(clamped).toEqual({
      questions: [
        { prompt: 'First question', description: 'Alph' },
        { prompt: '', description: '' },
      ],
    });
    expect(countAiOutputChars(clamped)).toBe(18);
  });

  it('does not count or truncate data uris', () => {
    const input = {
      title: 'Hello world',
      image: 'data:image/png;base64,abcdefghijklmnopqrstuvwxyz',
      body: 'More text',
    };

    const clamped = clampAiOutputChars(input, 5);

    expect(clamped).toEqual({
      title: 'Hello',
      image: 'data:image/png;base64,abcdefghijklmnopqrstuvwxyz',
      body: '',
    });
    expect(countAiOutputChars(clamped)).toBe(5);
  });
});
