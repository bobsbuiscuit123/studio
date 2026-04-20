import type { DashboardAsyncStatus } from '@/lib/dashboard-load';

type ResolveDashboardStatusInput = {
  clubDataStatus: DashboardAsyncStatus;
  hasClub: boolean;
  hasStaleDashboardData: boolean;
  pageError?: string | null;
  userStatus: DashboardAsyncStatus;
};

export function resolveDashboardStatus({
  clubDataStatus,
  hasClub,
  hasStaleDashboardData,
  pageError,
  userStatus,
}: ResolveDashboardStatusInput): DashboardAsyncStatus {
  if (!hasClub) {
    return 'empty';
  }
  if (pageError) {
    return 'error';
  }
  if (!hasStaleDashboardData && (userStatus === 'loading' || clubDataStatus === 'loading')) {
    return 'loading';
  }
  if (!hasStaleDashboardData && (userStatus === 'retrying' || clubDataStatus === 'retrying')) {
    return 'retrying';
  }
  if (!hasStaleDashboardData && (userStatus === 'error' || clubDataStatus === 'error')) {
    return 'error';
  }
  return 'success';
}
