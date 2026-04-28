import { describe, expect, it } from 'vitest';

import {
  buildEngagementReportCsv,
  buildExecutiveDashboardPayload,
  buildOrgDashboardPayload,
} from '@/lib/command-center-analytics';

const fixedNow = new Date('2026-04-28T12:00:00.000Z');

describe('command center analytics', () => {
  it('dedupes active members and scores group statuses', () => {
    const payload = buildOrgDashboardPayload({
      org: { id: 'org-1', name: 'Dulles HS', usageEstimateMembers: 100 },
      now: fixedNow,
      assistantLogs: [],
      groups: [
        {
          id: 'robotics',
          name: 'Robotics Club',
          state: {
            members: [
              { name: 'Alex Sponsor', email: 'alex@example.com', role: 'Admin', avatar: '' },
              { name: 'Jordan', email: 'student@example.com', role: 'Member', avatar: '' },
            ],
            events: [
              {
                id: 'e1',
                title: 'Build Session',
                date: '2026-04-26T20:00:00.000Z',
                location: 'Room 101',
                attendanceRecords: [{ email: 'student@example.com', checkedInAt: '2026-04-26T20:05:00.000Z' }],
              },
            ],
          },
        },
        {
          id: 'debate',
          name: 'Debate Club',
          state: {
            members: [
              { name: 'Jordan Duplicate', email: 'STUDENT@example.com', role: 'Member', avatar: '' },
            ],
            events: [],
          },
        },
      ],
    });

    expect(payload.kpis.totalActiveMembers).toBe(2);
    expect(payload.kpis.weeklyMeetingDensity).toBe(1);
    expect(payload.kpis.engagementPercent).toBe(2);
    expect(payload.groups.find(group => group.groupId === 'robotics')?.status).toBe('active');
    expect(payload.groups.find(group => group.groupId === 'debate')?.status).toBe('alert');
  });

  it('marks groups without attendance evidence as non-compliant', () => {
    const payload = buildOrgDashboardPayload({
      org: { id: 'org-1', name: 'Dulles HS', usageEstimateMembers: 10 },
      now: fixedNow,
      assistantLogs: [],
      groups: [
        {
          id: 'art',
          name: 'Art Club',
          state: {
            members: [{ name: 'Sponsor', email: 'sponsor@example.com', role: 'Officer', avatar: '' }],
            events: [{ id: 'event-1', title: 'Studio', date: '2026-04-27T20:00:00.000Z', location: 'A1' }],
          },
        },
      ],
    });

    expect(payload.groups[0].compliant).toBe(false);
    expect(payload.kpis.compliancePercent).toBe(0);
    expect(payload.auditLog.some(alert => alert.title === 'Attendance evidence missing')).toBe(true);
  });

  it('builds executive totals across orgs', () => {
    const payload = buildExecutiveDashboardPayload({
      now: fixedNow,
      assistantLogs: [
        {
          id: 'log-1',
          org_id: 'org-1',
          group_id: 'robotics',
          action_type: 'create_announcement',
          result: 'success',
          created_at: '2026-04-27T12:00:00.000Z',
        },
      ],
      orgs: [
        { id: 'org-1', name: 'Dulles HS', usageEstimateMembers: 100 },
        { id: 'org-2', name: 'Clements HS', usageEstimateMembers: 200 },
      ],
      groupsByOrgId: {
        'org-1': [
          {
            id: 'robotics',
            name: 'Robotics',
            state: {
              members: [{ name: 'A', email: 'a@example.com', role: 'Admin', avatar: '' }],
              events: [
                {
                  id: 'e1',
                  title: 'Meet',
                  date: '2026-04-27T12:00:00.000Z',
                  points: 1,
                  attendanceRecords: [{ email: 'a@example.com', checkedInAt: '2026-04-27T12:10:00.000Z' }],
                },
              ],
              pointEntries: [{ id: 'p1', memberEmail: 'a@example.com', points: 3, reason: 'Volunteer', date: '2026-04-27', awardedBy: 'lead@example.com' }],
            },
          },
        ],
        'org-2': [
          {
            id: 'math',
            name: 'Math',
            state: {
              members: [{ name: 'B', email: 'b@example.com', role: 'Admin', avatar: '' }],
              events: [],
            },
          },
        ],
      },
    });

    expect(payload.ownedOrgCount).toBe(2);
    expect(payload.kpis.totalImpactedStudents).toBe(2);
    expect(payload.kpis.totalResourceHours).toBe(4);
    expect(payload.kpis.tasksAutomated).toBe(1);
    expect(payload.campuses).toHaveLength(2);
  });

  it('exports dashboard rows as csv', () => {
    const csv = buildEngagementReportCsv([
      {
        orgName: 'Dulles HS',
        groupName: 'Robotics, Advanced',
        activeMembers: 12,
        sponsor: 'Alex <alex@example.com>',
        lastActivityDate: 'Apr 27, 2026',
        status: 'Active',
        compliant: 'Yes',
        resourceHours: 18,
        tasksAutomated: 2,
      },
    ]);

    expect(csv).toContain('orgName,groupName,activeMembers');
    expect(csv).toContain('"Robotics, Advanced"');
  });
});
