import { describe, it, expect, vi, beforeEach } from "vitest";

import { prisma } from "@/lib/db/root";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// `@/lib/storage` is mocked; the jobs only touch these four methods.
const storageMock = {
  createDownloadUrl: vi.fn(
    async (key: string) => `https://storage.test/get/${encodeURIComponent(key)}`,
  ),
  putObject: vi.fn(async () => {}),
  deletePrefix: vi.fn(async () => {}),
  headObject: vi.fn(async () => null),
};
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return { ...actual, storage: storageMock };
});

// `spawn` is faked. "enoent" models a machine with no ffprobe/ffmpeg: the child
// emits an `error` event carrying ENOENT. "timeout" models Node killing a hung
// child on the spawn timeout: a `close` with signal SIGKILL and no exit code.
let spawnBehavior: "enoent" | "timeout" = "enoent";
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event: string, cb: (...args: unknown[]) => void) => {
        if (spawnBehavior === "enoent" && event === "error") {
          queueMicrotask(() => cb({ code: "ENOENT" }));
        }
        if (spawnBehavior === "timeout" && event === "close") {
          queueMicrotask(() => cb(null, "SIGKILL"));
        }
      },
    };
    return child;
  }),
}));

async function makeOrg(prefix: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: prefix, slug: `${prefix}-${suffix}` },
  });
  const user = await prisma.user.create({
    data: { email: `${prefix}-${suffix}@test.local`, name: "Tester" },
  });
  return { org, user };
}

beforeEach(() => {
  vi.clearAllMocks();
  spawnBehavior = "enoent";
});

describe("sweepStuckUploads", () => {
  it("fails a stale UPLOADING asset and clears its prefix, leaving a fresh one alone", async () => {
    const { org } = await makeOrg("stuck");
    const stale = await prisma.mediaAsset.create({
      data: {
        organizationId: org.id,
        kind: "IMAGE",
        status: "UPLOADING",
        name: "stale",
        createdAt: new Date(Date.now() - 2 * HOUR_MS),
      },
    });
    const fresh = await prisma.mediaAsset.create({
      data: { organizationId: org.id, kind: "IMAGE", status: "UPLOADING", name: "fresh" },
    });

    const { sweepStuckUploads } = await import("@/worker/jobs/sweepStuckUploads");
    const res = await sweepStuckUploads();

    expect(res.failed).toBeGreaterThanOrEqual(1);
    expect((await prisma.mediaAsset.findUnique({ where: { id: stale.id } }))?.status).toBe(
      "FAILED",
    );
    expect((await prisma.mediaAsset.findUnique({ where: { id: fresh.id } }))?.status).toBe(
      "UPLOADING",
    );
    expect(storageMock.deletePrefix).toHaveBeenCalledWith(`org/${org.id}/${stale.id}/`);
  });
});

describe("purgeArchivedMedia", () => {
  it("deletes an old unreferenced asset, keeps a referenced one and a recent one", async () => {
    const { org } = await makeOrg("purge");
    const eightDaysAgo = new Date(Date.now() - 8 * DAY_MS);
    const oneDayAgo = new Date(Date.now() - DAY_MS);

    const free = await prisma.mediaAsset.create({
      data: {
        organizationId: org.id,
        kind: "IMAGE",
        status: "READY",
        name: "old-free",
        archivedAt: eightDaysAgo,
      },
    });
    const referenced = await prisma.mediaAsset.create({
      data: {
        organizationId: org.id,
        kind: "IMAGE",
        status: "READY",
        name: "old-referenced",
        archivedAt: eightDaysAgo,
      },
    });
    const recent = await prisma.mediaAsset.create({
      data: {
        organizationId: org.id,
        kind: "IMAGE",
        status: "READY",
        name: "recent",
        archivedAt: oneDayAgo,
      },
    });

    // A Picture row needs the Canvas -> Panel -> Frame -> Content chain.
    const canvas = await prisma.canvas.create({
      data: { organizationId: org.id, name: "c", width: 1920, height: 1080 },
    });
    const panel = await prisma.panel.create({
      data: {
        organizationId: org.id,
        canvasId: canvas.id,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
    });
    const frame = await prisma.frame.create({
      data: { organizationId: org.id, panelId: panel.id, type: "PICTURE" },
    });
    const content = await prisma.content.create({
      data: { organizationId: org.id, frameId: frame.id },
    });
    await prisma.picture.create({
      data: { contentId: content.id, organizationId: org.id, mediaAssetId: referenced.id },
    });

    const { purgeArchivedMedia } = await import("@/worker/jobs/purgeArchivedMedia");
    const res = await purgeArchivedMedia();

    expect(res.purged).toBeGreaterThanOrEqual(1);
    expect(await prisma.mediaAsset.findUnique({ where: { id: free.id } })).toBeNull();
    expect(await prisma.mediaAsset.findUnique({ where: { id: referenced.id } })).not.toBeNull();
    expect(await prisma.mediaAsset.findUnique({ where: { id: recent.id } })).not.toBeNull();
    expect(storageMock.deletePrefix).toHaveBeenCalledWith(`org/${org.id}/${free.id}/`);
  });

  it("keeps an archived asset referenced by a PlaylistItem", async () => {
    const { org } = await makeOrg("purge-playlist");
    const eightDaysAgo = new Date(Date.now() - 8 * DAY_MS);

    const asset = await prisma.mediaAsset.create({
      data: {
        organizationId: org.id,
        kind: "IMAGE",
        status: "READY",
        name: "in-playlist",
        archivedAt: eightDaysAgo,
      },
    });

    const playlist = await prisma.playlist.create({
      data: { organizationId: org.id, name: "P" },
    });
    await prisma.playlistItem.create({
      data: {
        organizationId: org.id,
        playlistId: playlist.id,
        mediaAssetId: asset.id,
        position: 0,
      },
    });

    const { purgeArchivedMedia } = await import("@/worker/jobs/purgeArchivedMedia");
    const res = await purgeArchivedMedia();

    expect(await prisma.mediaAsset.findUnique({ where: { id: asset.id } })).not.toBeNull();
    expect(res.purged).toBe(0);
  });
});

describe("processMediaAsset", () => {
  it("marks a job DONE without throwing when ffprobe is absent", async () => {
    const { org } = await makeOrg("proc");
    const asset = await prisma.mediaAsset.create({
      data: {
        organizationId: org.id,
        kind: "VIDEO",
        status: "READY",
        name: "clip",
        mimeType: "video/mp4",
        storageKey: `org/${org.id}/pending/original.mp4`,
      },
    });
    const job = await prisma.mediaProcessingJob.create({ data: { mediaAssetId: asset.id } });

    const { processMediaAsset } = await import("@/worker/jobs/processMediaAsset");
    const res = await processMediaAsset();

    expect(res.failed).toBe(0);
    const updatedJob = await prisma.mediaProcessingJob.findUnique({ where: { id: job.id } });
    expect(updatedJob?.status).toBe("DONE");
    expect(updatedJob?.attempts).toBe(0);
    const updatedAsset = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
    expect(updatedAsset?.durationSeconds).toBeNull();
    expect(updatedAsset?.thumbnailKey).toBeNull();
    expect(storageMock.putObject).not.toHaveBeenCalled();
  });

  it("bumps attempts and records a timeout error when ffprobe is killed on the spawn timeout", async () => {
    spawnBehavior = "timeout";
    const { org } = await makeOrg("proc-timeout");
    const asset = await prisma.mediaAsset.create({
      data: {
        organizationId: org.id,
        kind: "VIDEO",
        status: "READY",
        name: "clip",
        mimeType: "video/mp4",
        storageKey: `org/${org.id}/pending/original.mp4`,
      },
    });
    const job = await prisma.mediaProcessingJob.create({ data: { mediaAssetId: asset.id } });

    const { processMediaAsset } = await import("@/worker/jobs/processMediaAsset");
    await processMediaAsset();

    const updatedJob = await prisma.mediaProcessingJob.findUnique({ where: { id: job.id } });
    // attempts 1 of 5, so still retryable (PENDING), not parked FAILED yet.
    expect(updatedJob?.attempts).toBe(1);
    expect(updatedJob?.status).toBe("PENDING");
    expect(updatedJob?.lastError).toMatch(/timed out/i);
    const updatedAsset = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
    expect(updatedAsset?.durationSeconds).toBeNull();
  });
});
