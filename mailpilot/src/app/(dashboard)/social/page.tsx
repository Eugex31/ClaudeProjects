import { Suspense } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MetaConnectionView } from "@/components/social/meta-connection-view";
import { PostsView } from "@/components/social/posts-view";

export default function SocialPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Social</h1>
        <p className="text-sm text-muted-foreground">Connect accounts and post to Facebook and Instagram.</p>
      </div>
      <Tabs defaultValue="posts">
        <TabsList>
          <TabsTrigger value="posts">Posts</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
        </TabsList>
        <TabsContent value="posts">
          <Suspense>
            <PostsView />
          </Suspense>
        </TabsContent>
        <TabsContent value="accounts">
          <Suspense>
            <MetaConnectionView />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
