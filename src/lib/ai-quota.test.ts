import { enforceAiQuota } from '@/lib/ai-quota';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } } }),
    },
  }),
}));

const upsertMock = vi.fn(async () => ({}));
const selectMock = vi.fn(() => ({
  eq: () => ({
    eq: () => ({
      maybeSingle: async () => ({ data: { count: 3 } }),
    }),
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdmin: () => ({
    from: () => ({
      select: selectMock,
      upsert: upsertMock,
    }),
  }),
}));

describe('enforceAiQuota', () => {
  it('blocks when quota exceeded', async () => {
    const result = await enforceAiQuota(3);
    expect(result.ok).toBe(false);
  });
});

