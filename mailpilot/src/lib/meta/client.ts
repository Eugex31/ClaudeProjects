const GRAPH_API_URL = "https://graph.facebook.com/v21.0";

export class MetaApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaApiError";
  }
}

type GraphErrorBody = { error?: { message?: string } };

async function graphRequest<T>(path: string, params: Record<string, string>, method: "GET" | "POST" = "GET"): Promise<T> {
  const url = new URL(`${GRAPH_API_URL}${path}`);
  let body: BodyInit | undefined;
  if (method === "GET") {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  } else {
    body = new URLSearchParams(params);
  }

  const res = await fetch(url, { method, body });
  const json = (await res.json()) as T & GraphErrorBody;
  if (!res.ok || json.error) {
    throw new MetaApiError(json.error?.message ?? `Meta Graph API request failed with status ${res.status}`);
  }
  return json;
}

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
  const data = await graphRequest<{ access_token: string }>("/oauth/access_token", {
    client_id: process.env.FACEBOOK_APP_ID ?? "",
    client_secret: process.env.FACEBOOK_APP_SECRET ?? "",
    redirect_uri: redirectUri,
    code,
  });
  return data.access_token;
}

// Meta's documented standard duration for a long-lived user token when a
// response omits expires_in (observed in practice — the exchange call can
// succeed with a real, working token but no expires_in field). Falling back
// here means a real token never gets thrown away over a missing metadata
// field; expiresAt is advisory (nothing currently re-derives it), not what
// makes the token work.
const DEFAULT_LONG_LIVED_TOKEN_SECONDS = 60 * 24 * 60 * 60;

// Short-lived user tokens (~1-2h) are exchanged immediately for a long-lived
// one (~60 days) — MetaIdentity always stores the long-lived version, never
// the short-lived one from the OAuth callback directly.
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const data = await graphRequest<{ access_token: string; expires_in?: number }>("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: process.env.FACEBOOK_APP_ID ?? "",
    client_secret: process.env.FACEBOOK_APP_SECRET ?? "",
    fb_exchange_token: shortLivedToken,
  });
  const expiresInSeconds =
    typeof data.expires_in === "number" && Number.isFinite(data.expires_in)
      ? data.expires_in
      : DEFAULT_LONG_LIVED_TOKEN_SECONDS;
  return { accessToken: data.access_token, expiresInSeconds };
}

export type MetaPage = {
  pageId: string;
  pageName: string;
  pageAccessToken: string; // server-side only — never returned to the client, see the /pages route
  instagram: { id: string; username: string } | null;
};

type GranularScope = { scope: string; target_ids?: string[] };

// /me/accounts lists Pages the user personally administers under the
// CLASSIC Facebook Login flow — it does NOT reliably list Pages granted
// through "Facebook Login for Business" (routed via a Business Portfolio),
// which is what this app's OAuth consent screen actually uses. Confirmed
// directly against the real API: a token whose consent screen granted a
// specific Page came back with an empty /me/accounts list, while fetching
// that same Page by ID with the same token succeeded fine — the grant was
// real, /me/accounts just doesn't surface it.
//
// The correct discovery mechanism for Business Login is reading the
// token's own granular_scopes via /debug_token, which lists exactly which
// Page/Instagram asset IDs were granted (per Meta's Business Login docs) —
// this is what the consent screen's per-asset checkboxes actually produce.
async function fetchGrantedAssetIds(userAccessToken: string): Promise<{ pageIds: string[]; instagramIds: string[] }> {
  const appId = process.env.FACEBOOK_APP_ID ?? "";
  const appSecret = process.env.FACEBOOK_APP_SECRET ?? "";
  const data = await graphRequest<{ data: { granular_scopes?: GranularScope[] } }>("/debug_token", {
    input_token: userAccessToken,
    access_token: `${appId}|${appSecret}`,
  });

  const scopes = data.data.granular_scopes ?? [];
  const pageIds = new Set<string>();
  const instagramIds = new Set<string>();
  for (const s of scopes) {
    if (s.scope === "pages_show_list" || s.scope === "pages_manage_posts") {
      for (const id of s.target_ids ?? []) pageIds.add(id);
    }
    if (s.scope === "instagram_basic" || s.scope === "instagram_content_publish") {
      for (const id of s.target_ids ?? []) instagramIds.add(id);
    }
  }
  return { pageIds: [...pageIds], instagramIds: [...instagramIds] };
}

// One call to discover granted asset IDs, one follow-up call per granted
// Page for its name/token/linked-Instagram (Graph API has no way to fetch
// all of that for multiple pages in a single request). Page tokens
// returned here are already long-lived when the user token is long-lived —
// no separate exchange needed per page.
export async function listPages(userAccessToken: string): Promise<MetaPage[]> {
  const { pageIds, instagramIds } = await fetchGrantedAssetIds(userAccessToken);

  const pages = await Promise.all(
    pageIds.map(async (pageId) => {
      const page = await graphRequest<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string; username: string } }>(
        `/${pageId}`,
        { access_token: userAccessToken, fields: "id,name,access_token,instagram_business_account{id,username}" }
      );
      // Cross-check against the granted Instagram ids rather than trusting
      // the page's linked account blindly — only surface it as postable if
      // the consent screen actually granted access to that specific IG asset.
      const linkedIg = page.instagram_business_account;
      const instagram = linkedIg && instagramIds.includes(linkedIg.id) ? { id: linkedIg.id, username: linkedIg.username } : null;
      return { pageId: page.id, pageName: page.name, pageAccessToken: page.access_token, instagram };
    })
  );
  return pages;
}

// Facebook has one post shape that branches on whether there's an image;
// Instagram has no text-only post type at all and always needs the
// two-call container flow — genuinely different, not a single unified call.
export async function publishToPage(
  pageAccessToken: string,
  pageId: string,
  input: { message: string; imageUrl?: string }
): Promise<string> {
  if (input.imageUrl) {
    const data = await graphRequest<{ post_id?: string; id: string }>(
      `/${pageId}/photos`,
      { url: input.imageUrl, caption: input.message, access_token: pageAccessToken },
      "POST"
    );
    return data.post_id ?? data.id;
  }
  const data = await graphRequest<{ id: string }>(
    `/${pageId}/feed`,
    { message: input.message, access_token: pageAccessToken },
    "POST"
  );
  return data.id;
}

// Meta fetches the image directly from imageUrl server-side (no bytes flow
// through this app) — same reasoning as publishToPage's photos call.
export async function publishToInstagram(
  pageAccessToken: string,
  igUserId: string,
  input: { caption: string; imageUrl: string }
): Promise<string> {
  const container = await graphRequest<{ id: string }>(
    `/${igUserId}/media`,
    { image_url: input.imageUrl, caption: input.caption, access_token: pageAccessToken },
    "POST"
  );
  const published = await graphRequest<{ id: string }>(
    `/${igUserId}/media_publish`,
    { creation_id: container.id, access_token: pageAccessToken },
    "POST"
  );
  return published.id;
}

export type SocialPostMetrics = {
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
};

// Facebook: likes/comments/shares are all readable with the already-granted
// pages_read_engagement scope — no per-post view metric is exposed for
// ordinary feed posts/photos, so viewCount stays null there. Instagram:
// like/comment counts are readable with the already-granted instagram_basic
// scope; impressions/reach (viewCount) need the separate
// instagram_manage_insights scope, requested but not yet grantable until
// the app is reconnected + reviewed — that one call is wrapped so its
// failure never blocks the counts that do work today.
export async function getPostMetrics(
  pageAccessToken: string,
  platform: "FACEBOOK_PAGE" | "INSTAGRAM_BUSINESS",
  externalPostId: string
): Promise<SocialPostMetrics> {
  if (platform === "FACEBOOK_PAGE") {
    const data = await graphRequest<{
      likes?: { summary?: { total_count?: number } };
      comments?: { summary?: { total_count?: number } };
      shares?: { count?: number };
    }>(`/${externalPostId}`, {
      fields: "likes.summary(true),comments.summary(true),shares",
      access_token: pageAccessToken,
    });
    return {
      viewCount: null,
      likeCount: data.likes?.summary?.total_count ?? null,
      commentCount: data.comments?.summary?.total_count ?? null,
      shareCount: data.shares?.count ?? null,
    };
  }

  const counts = await graphRequest<{ like_count?: number; comments_count?: number }>(`/${externalPostId}`, {
    fields: "like_count,comments_count",
    access_token: pageAccessToken,
  });

  let viewCount: number | null = null;
  try {
    const insights = await graphRequest<{ data: { name: string; values: { value: number }[] }[] }>(
      `/${externalPostId}/insights`,
      { metric: "impressions,reach", access_token: pageAccessToken }
    );
    const impressions = insights.data.find((m) => m.name === "impressions")?.values?.[0]?.value;
    viewCount = impressions ?? null;
  } catch {
    // Missing instagram_manage_insights scope until reconnected + reviewed — expected, not fatal.
  }

  return {
    viewCount,
    likeCount: counts.like_count ?? null,
    commentCount: counts.comments_count ?? null,
    shareCount: null, // Instagram has no share count
  };
}

export async function getFollowerCount(
  pageAccessToken: string,
  platform: "FACEBOOK_PAGE" | "INSTAGRAM_BUSINESS",
  externalAccountId: string
): Promise<number | null> {
  if (platform === "FACEBOOK_PAGE") {
    const data = await graphRequest<{ fan_count?: number }>(`/${externalAccountId}`, {
      fields: "fan_count",
      access_token: pageAccessToken,
    });
    return data.fan_count ?? null;
  }
  const data = await graphRequest<{ followers_count?: number }>(`/${externalAccountId}`, {
    fields: "followers_count",
    access_token: pageAccessToken,
  });
  return data.followers_count ?? null;
}
