import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { MembersTable } from "@/app/(app)/users/members-table";

// The actions menu pulls in the "use server" module (prisma, next/cache, mail).
// The table only needs its shape, so stub the server actions out.
vi.mock("@/app/(app)/users/actions", () => ({
  updateMemberRole: vi.fn(async () => ({})),
  removeMember: vi.fn(async () => ({})),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const members = [
  {
    id: "m1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    role: "OWNER" as const,
    joined: "1 Jan 2026",
    isSelf: true,
  },
  {
    id: "m2",
    name: "Grace Hopper",
    email: "grace@example.com",
    role: "ADMIN" as const,
    joined: "2 Jan 2026",
    isSelf: false,
  },
];

const invitations = [
  { id: "i1", email: "alan@example.com", role: "MANAGER" as const, status: "Invited" },
];

describe("MembersTable", () => {
  it("renders member names, emails, role badges and the invitation without throwing", () => {
    const { getByText, getAllByText, getByLabelText } = render(
      <MembersTable
        members={members}
        invitations={invitations}
        canUpdateRole
        canRemove
        actorIsOwner
      />,
    );

    expect(getByText("Ada Lovelace")).toBeTruthy();
    expect(getByText("grace@example.com")).toBeTruthy();
    expect(getByText("Owner")).toBeTruthy();
    expect(getAllByText("Admin").length).toBeGreaterThan(0);

    // Pending invitations section.
    expect(getByText("alan@example.com")).toBeTruthy();
    expect(getByText("Invited")).toBeTruthy();

    // One actions trigger per member row.
    expect(getByLabelText("Actions for Ada Lovelace")).toBeTruthy();
    expect(getByLabelText("Actions for Grace Hopper")).toBeTruthy();
  });

  it("shows the empty invitations copy and no actions column when capabilities are absent", () => {
    const { getByText, queryByLabelText } = render(
      <MembersTable
        members={members}
        invitations={[]}
        canUpdateRole={false}
        canRemove={false}
        actorIsOwner={false}
      />,
    );

    expect(getByText("No invitations are waiting to be accepted.")).toBeTruthy();
    expect(queryByLabelText("Actions for Ada Lovelace")).toBeNull();
  });
});
