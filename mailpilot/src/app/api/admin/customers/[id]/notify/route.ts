import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/adminAuth";
import { logAdminAction } from "@/lib/adminAudit";
import { notifyCustomerSchema } from "@/lib/validation/admin.schema";
import { sendSystemEmail } from "@/lib/email/sendSystemEmail";

export const POST = withAdminAuth<{ id: string }>(async (req, { params, adminEmail }) => {
  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const { subject, message } = notifyCustomerSchema.parse(await req.json());

  await sendSystemEmail({
    to: user.email,
    subject,
    text: message,
    html: `<p>${message.replace(/\n/g, "<br>")}</p>`,
  });

  await logAdminAction({
    adminEmail,
    targetUserId: user.id,
    targetEmail: user.email,
    targetName: user.name,
    action: "NOTIFY",
    details: `Subject: ${subject}`,
  });

  return NextResponse.json({ ok: true });
});
