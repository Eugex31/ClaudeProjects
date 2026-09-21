import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  const { callbackUrl } = await searchParams;

  if (session) {
    redirect(callbackUrl ?? "/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="LyneSign Marketing" className="mx-auto mb-2 h-12 w-auto" />
          <CardTitle className="text-2xl">LyneSign Marketing</CardTitle>
          <CardDescription>Sign in to send and manage your campaigns.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <LoginForm callbackUrl={callbackUrl} />
          <div className="flex items-center gap-2">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: callbackUrl ?? "/dashboard" });
            }}
          >
            <Button type="submit" variant="outline" className="w-full">
              Continue with Google
            </Button>
          </form>
          <p className="text-center text-xs text-muted-foreground">
            We only request permission to send email as you. We never read your
            inbox. By continuing you agree to send only to recipients you have
            permission to contact, per CAN-SPAM, GDPR, and Gmail&apos;s policies.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
