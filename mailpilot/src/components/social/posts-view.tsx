"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PostComposerDialog, type SocialPostRecord } from "@/components/social/post-composer-dialog";

type Post = SocialPostRecord & {
  status: "DRAFT" | "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "FAILED";
  scheduledAt: string | null;
  publishedAt: string | null;
  errorMessage: string | null;
  socialAccount: { displayName: string; platform: "FACEBOOK_PAGE" | "INSTAGRAM_BUSINESS" };
};

const STATUS_VARIANT: Record<Post["status"], "default" | "outline" | "destructive" | "secondary"> = {
  DRAFT: "outline",
  SCHEDULED: "secondary",
  PUBLISHING: "secondary",
  PUBLISHED: "default",
  FAILED: "destructive",
};

export function PostsView() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/social/posts");
    if (res.ok) {
      const data = await res.json();
      setPosts(data.posts);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function remove(id: string) {
    setBusy(true);
    const res = await fetch(`/api/social/posts/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast.error("Failed to delete post");
      return;
    }
    toast.success("Post deleted");
    load();
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <PostComposerDialog onSaved={load} />

        {posts === null ? (
          <Skeleton className="h-24 w-full" />
        ) : posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No posts yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {posts.map((p) => (
              <div key={p.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.socialAccount.displayName}</span>
                    <Badge variant={STATUS_VARIANT[p.status]}>{p.status}</Badge>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{p.caption || "(no caption)"}</p>
                  {p.status === "FAILED" && p.errorMessage && (
                    <p className="text-xs text-destructive">{p.errorMessage}</p>
                  )}
                  {p.scheduledAt && p.status === "SCHEDULED" && (
                    <p className="text-xs text-muted-foreground">Scheduled for {new Date(p.scheduledAt).toLocaleString()}</p>
                  )}
                  {p.publishedAt && (
                    <p className="text-xs text-muted-foreground">Published {new Date(p.publishedAt).toLocaleString()}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  {(p.status === "DRAFT" || p.status === "SCHEDULED" || p.status === "FAILED") && (
                    <PostComposerDialog
                      post={p}
                      onSaved={load}
                      trigger={
                        <Button variant="outline" size="sm">
                          Edit
                        </Button>
                      }
                    />
                  )}
                  <Button variant="ghost" size="sm" onClick={() => remove(p.id)} disabled={busy}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
