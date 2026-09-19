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

// Short-lived user tokens (~1-2h) are exchanged immediately for a long-lived
// one (~60 days) — MetaIdentity always stores the long-lived version, never
// the short-lived one from the OAuth callback directly.
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const data = await graphRequest<{ access_token: string; expires_in: number }>("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: process.env.FACEBOOK_APP_ID ?? "",
    client_secret: process.env.FACEBOOK_APP_SECRET ?? "",
    fb_exchange_token: shortLivedToken,
  });
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
}

export type MetaPage = {
  pageId: string;
  pageName: string;
  pageAccessToken: string; // server-side only — never returned to the client, see the /pages route
  instagram: { id: string; username: string } | null;
};

// One call for the user's Pages, one follow-up call per page for its linked
// Instagram Business account (Graph API has no way to fetch both in a
// single request). Page tokens returned here are already long-lived when
// the user token used to fetch them is long-lived — no separate exchange
// needed per page.
export async function listPages(userAccessToken: string): Promise<MetaPage[]> {
  const data = await graphRequest<{ data: { id: string; name: string; access_token: string }[] }>("/me/accounts", {
    access_token: userAccessToken,
    fields: "id,name,access_token",
  });

  const pages = await Promise.all(
    data.data.map(async (page) => {
      let instagram: MetaPage["instagram"] = null;
      try {
        const igData = await graphRequest<{ instagram_business_account?: { id: string; username: string } }>(
          `/${page.id}`,
          { access_token: page.access_token, fields: "instagram_business_account{id,username}" }
        );
        if (igData.instagram_business_account) {
          instagram = { id: igData.instagram_business_account.id, username: igData.instagram_business_account.username };
        }
      } catch {
        // A page with no linked Instagram account, or one this app lacks
        // instagram_basic scope for yet, just has no IG option — not fatal.
      }
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
