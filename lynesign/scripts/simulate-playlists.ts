/**
 * One-off: give "Costa Signage Co" two real playlists so the Playlists pages and
 * the player sync endpoint have something to show.
 *
 *   - "Storefront Loop": every non-archived, READY image in the library that is
 *     not a menu board, eight seconds per image by default. Assigned to the
 *     Window, Storefront and Entrance screens.
 *   - "Menu Rotation": the menu-board images, twelve seconds each via a per-item
 *     override, with a matching twelve-second image default. Assigned to the
 *     Breakroom and Cafe screens.
 *
 * Screen assignment is written straight through with prisma.screen.updateMany:
 * this is a seed script, not the gated assignPlaylistToScreen action, and it
 * does not bump a playlist revision (assignment never does).
 *
 * Re-run safe: exits if the org already has a Playlist unless --force is passed
 * (which builds a second set alongside the existing ones).
 *
 *   npm run db:up
 *   npx tsx scripts/simulate-playlists.ts [--force]
 */
import { prisma } from "@/lib/db/root";
import { withOrgTransaction } from "@/lib/db/tenant";

const ORG_NAME = "Costa Signage Co";
const FORCE = process.argv.includes("--force");

async function main() {
  const org = await prisma.organization.findFirst({ where: { name: ORG_NAME } });
  if (!org) {
    throw new Error(`No organization named "${ORG_NAME}". Register it first at /register.`);
  }

  const existing = await prisma.playlist.count({ where: { organizationId: org.id } });
  if (existing > 0 && !FORCE) {
    console.log(`Org already has ${existing} playlists. Pass --force to build another set.`);
    return;
  }

  const owner = await prisma.membership.findFirst({
    where: { organizationId: org.id, role: "OWNER" },
  });

  const images = await prisma.mediaAsset.findMany({
    where: {
      organizationId: org.id,
      kind: "IMAGE",
      status: "READY",
      archivedAt: null,
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const isMenu = (name: string) => /menu/i.test(name);
  const storefrontImages = images.filter((a) => !isMenu(a.name));
  const menuImages = images.filter((a) => isMenu(a.name));

  if (images.length === 0) {
    throw new Error("No ready images in the library. Run scripts/simulate-media.ts first.");
  }

  const built = await withOrgTransaction(org.id, async (tx) => {
    const storefront = await tx.playlist.create({
      data: {
        organizationId: org.id,
        name: "Storefront Loop",
        description: "Promo and brand imagery for customer-facing screens.",
        defaultImageDurationSeconds: 8,
        createdByUserId: owner?.userId ?? null,
      },
    });
    for (let i = 0; i < storefrontImages.length; i++) {
      await tx.playlistItem.create({
        data: {
          organizationId: org.id,
          playlistId: storefront.id,
          mediaAssetId: storefrontImages[i].id,
          position: i,
          enabled: true,
        },
      });
    }

    const menu = await tx.playlist.create({
      data: {
        organizationId: org.id,
        name: "Menu Rotation",
        description: "The menu boards, twelve seconds each.",
        defaultImageDurationSeconds: 12,
        createdByUserId: owner?.userId ?? null,
      },
    });
    for (let i = 0; i < menuImages.length; i++) {
      await tx.playlistItem.create({
        data: {
          organizationId: org.id,
          playlistId: menu.id,
          mediaAssetId: menuImages[i].id,
          position: i,
          durationSeconds: 12,
          enabled: true,
        },
      });
    }

    return { storefrontId: storefront.id, menuId: menu.id };
  });

  const screens = await prisma.screen.findMany({
    where: { organizationId: org.id },
    select: { id: true, name: true },
  });
  const nameHas = (name: string, words: string[]) =>
    words.some((w) => name.toLowerCase().includes(w.toLowerCase()));

  const storefrontScreens = screens.filter((s) =>
    nameHas(s.name, ["Window", "Storefront", "Entrance"]),
  );
  const menuScreens = screens.filter((s) => nameHas(s.name, ["Breakroom", "Cafe"]));

  if (storefrontScreens.length > 0) {
    await prisma.screen.updateMany({
      where: { id: { in: storefrontScreens.map((s) => s.id) } },
      data: { playlistId: built.storefrontId },
    });
  }
  if (menuScreens.length > 0) {
    await prisma.screen.updateMany({
      where: { id: { in: menuScreens.map((s) => s.id) } },
      data: { playlistId: built.menuId },
    });
  }

  const itemsTotal = await prisma.playlistItem.count({
    where: { playlistId: { in: [built.storefrontId, built.menuId] } },
  });

  console.log(`\nPlaylist simulation complete for ${ORG_NAME}`);
  console.table({
    playlists: 2,
    itemsTotal,
    screensAssigned: storefrontScreens.length + menuScreens.length,
  });
  console.log(
    `Storefront Loop: ${storefrontImages.length} images, screens: ${
      storefrontScreens.map((s) => s.name).join(", ") || "none matched"
    }`,
  );
  console.log(
    `Menu Rotation: ${menuImages.length} images, screens: ${
      menuScreens.map((s) => s.name).join(", ") || "none matched"
    }`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
