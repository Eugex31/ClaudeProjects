import { PrismaClient, PlanKey } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const plans: Array<Parameters<typeof prisma.plan.upsert>[0]["create"]> = [
    { key: PlanKey.TRIAL, name: "Trial", maxScreens: 3, maxUsers: 3, maxLocations: 1, maxStorageBytes: BigInt(1_073_741_824), isPublic: false },
    { key: PlanKey.STARTER, name: "Starter", maxScreens: 10, maxUsers: 10, maxLocations: 3, maxStorageBytes: BigInt(10_737_418_240) },
    { key: PlanKey.GROWTH, name: "Growth", maxScreens: 50, maxUsers: 50, maxLocations: 20, maxStorageBytes: BigInt(107_374_182_400) },
    { key: PlanKey.ENTERPRISE, name: "Enterprise", maxScreens: null, maxUsers: null, maxLocations: null, maxStorageBytes: null },
  ];
  for (const p of plans) {
    await prisma.plan.upsert({ where: { key: p.key }, update: p, create: p });
  }

  // `db:seed` is a documented deploy step, so the dev fallback password must
  // never reach a production database: a well-known credential on a super admin
  // is a full platform compromise. Refuse the super admin rather than create one
  // nobody meant to; the plans above are already seeded either way.
  const password = process.env.SEED_SUPERADMIN_PASSWORD;
  if (process.env.NODE_ENV === "production" && !password) {
    console.log(
      "Seed complete (plans only). Super admin SKIPPED: set SEED_SUPERADMIN_PASSWORD to create one in production.",
    );
    return;
  }

  const email = process.env.SEED_SUPERADMIN_EMAIL ?? "admin@lynesign.local";
  const hashedPassword = await bcrypt.hash(password ?? "changeme-in-dev", 12);
  await prisma.user.upsert({
    where: { email },
    update: { isSuperAdmin: true },
    create: { email, name: "Platform Admin", isSuperAdmin: true, hashedPassword, emailVerified: new Date() },
  });

  console.log("Seed complete. Super admin:", email);
}

main().finally(() => prisma.$disconnect());
