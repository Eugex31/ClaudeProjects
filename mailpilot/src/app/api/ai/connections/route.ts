import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { aiConnectionInputSchema } from "@/lib/validation/ai.schema";
import { encryptToken } from "@/lib/crypto/tokenCipher";
import { verifyOpenAiKey } from "@/lib/ai/providers/openai";
import { verifyAnthropicKey } from "@/lib/ai/providers/anthropic";

// Never return apiKey, even encrypted — it's not needed by any caller and
// there's no reason to put ciphertext on the wire.
const SAFE_SELECT = { id: true, provider: true, label: true, isDefault: true, createdAt: true } as const;

export const GET = withAuth(async (_req, { userId }) => {
  const connections = await prisma.aiConnection.findMany({
    where: { userId },
    select: SAFE_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ connections });
});

export const POST = withAuth(async (req, { userId }) => {
  const body = aiConnectionInputSchema.parse(await req.json());

  // Verify the key actually works with one cheap real call before saving —
  // otherwise an invalid key would only surface later as a confusing
  // failure the next time someone tries to generate content.
  const isValid =
    body.provider === "OPENAI" ? await verifyOpenAiKey(body.apiKey) : await verifyAnthropicKey(body.apiKey);
  if (!isValid) {
    return NextResponse.json({ error: "That API key was rejected by the provider — check it and try again." }, { status: 400 });
  }

  const existingCount = await prisma.aiConnection.count({ where: { userId } });

  const connection = await prisma.aiConnection.create({
    data: {
      userId,
      provider: body.provider,
      label: body.label,
      apiKey: encryptToken(body.apiKey),
      isDefault: existingCount === 0, // first connection is the default automatically
    },
    select: SAFE_SELECT,
  });
  return NextResponse.json({ connection }, { status: 201 });
});
