/**
 * One-off: give "Costa Signage Co" a second real member plus a second pending
 * invite, so the Users page and the dashboard team tile look lived-in.
 *   npx tsx scripts/simulate-team.ts
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/root";
import { hashPassword } from "@/lib/auth/password";
import { withOrgTransaction } from "@/lib/db/tenant";
import { writeAudit } from "@/lib/audit";

async function main() {
  const org = await prisma.organization.findFirst({ where: { name: "Costa Signage Co" } });
  if (!org) throw new Error("No organization named 'Costa Signage Co'.");
  const owner = await prisma.membership.findFirst({
    where: { organizationId: org.id, role: "OWNER" },
  });
  if (!owner) throw new Error("Org has no owner.");

  // Maria accepts her invite and becomes an active Manager.
  const maria = await prisma.user.upsert({
    where: { email: "maria@costasignage.test" },
    update: {},
    create: {
      email: "maria@costasignage.test",
      name: "Maria Alvarez",
      hashedPassword: await hashPassword("correct-horse-battery-staple"),
      emailVerified: new Date(),
    },
  });
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: maria.id, organizationId: org.id } },
    update: { role: "MANAGER", status: "ACTIVE" },
    create: { userId: maria.id, organizationId: org.id, role: "MANAGER", status: "ACTIVE" },
  });
  await prisma.invitation.updateMany({
    where: { organizationId: org.id, email: "maria@costasignage.test", acceptedAt: null },
    data: { acceptedAt: new Date() },
  });

  // A fresh pending invite for a content manager.
  await withOrgTransaction(org.id, async (tx) => {
    const existing = await tx.invitation.findFirst({
      where: { email: "devon@costasignage.test", acceptedAt: null },
    });
    if (!existing) {
      await tx.invitation.create({
        data: {
          email: "devon@costasignage.test",
          role: "CONTENT_MANAGER",
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
          invitedByUserId: owner.userId,
        },
      });
    }
  });
  await writeAudit({
    organizationId: org.id,
    actorType: "USER",
    actorId: owner.userId,
    action: "member.invite",
    targetType: "Invitation",
    metadata: { email: "devon@costasignage.test", role: "CONTENT_MANAGER" },
  });

  const members = await prisma.membership.count({
    where: { organizationId: org.id, status: "ACTIVE" },
  });
  const pending = await prisma.invitation.count({
    where: { organizationId: org.id, acceptedAt: null },
  });
  const screens = await prisma.screen.groupBy({
    by: ["status"],
    where: { organizationId: org.id },
    _count: true,
  });
  console.log(`Active members: ${members}`);
  console.log(`Pending invites: ${pending}`);
  console.log("Screens by status:", screens.map((s) => `${s.status}=${s._count}`).join(", "));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
