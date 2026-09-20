"use client";

import { useState, useTransition } from "react";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { LogOut, Unplug } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function UserMenu({
  name,
  email,
  image,
  hasPassword,
}: {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  hasPassword: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDisconnect() {
    startTransition(async () => {
      const res = await fetch("/api/account/disconnect", { method: "POST" });
      if (!res.ok) {
        toast.error("Failed to disconnect Gmail account");
        return;
      }
      const { signedOut } = await res.json();
      toast.success("Gmail account disconnected");
      if (signedOut) {
        await signOut({ callbackUrl: "/login" });
      } else {
        window.location.reload();
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar className="size-8">
              <AvatarImage src={image ?? undefined} alt={name ?? email ?? "User"} />
              <AvatarFallback>{(name ?? email ?? "?").charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirmOpen(true)}>
            <Unplug className="mr-2 size-4" />
            Disconnect Gmail
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => signOut({ callbackUrl: "/login" })}>
            <LogOut className="mr-2 size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect your Gmail account?</AlertDialogTitle>
            <AlertDialogDescription>
              {hasPassword
                ? "This revokes LyneSign Marketing's access to send email on your behalf. Any campaigns currently sending will be paused until you reconnect Gmail from Settings — you'll stay signed in."
                : "This revokes LyneSign Marketing's access to send email on your behalf and signs you out. Any campaigns currently sending will be paused until you reconnect. You'll need to sign in with Google again to resume sending."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={handleDisconnect}>
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
