import { requireOrgRole } from '@/lib/authz';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } } }),
    },
    from: () => ({
      select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { role: 'owner' } }),
            }),
          }),
        }),
    }),
  }),
}));

describe('requireOrgRole', () => {
  it('allows owner role', async () => {
    const result = await requireOrgRole('org-1', ['owner']);
    expect(result.ok).toBe(true);
  });
});
