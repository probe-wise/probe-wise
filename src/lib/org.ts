// Workspace roles. The SQL CHECK on org_members.role repeats these values;
// src/lib/__tests__/interview-sync.test.ts fails if they drift.

export const ORG_ROLES = [
  { value: "admin", label: "Admin", hint: "Manages the team and candidates, and interviews" },
  { value: "interviewer", label: "Interviewer", hint: "Adds candidates, schedules and runs interviews" },
] as const;

export type OrgRoleValue = (typeof ORG_ROLES)[number]["value"];

export const orgRoleLabel = (role: string) => ORG_ROLES.find((r) => r.value === role)?.label ?? role;
