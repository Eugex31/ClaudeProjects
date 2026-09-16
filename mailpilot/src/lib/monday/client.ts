const MONDAY_API_URL = "https://api.monday.com/v2";
// Monday requires an explicit API-Version header to avoid being silently
// defaulted onto whatever version is current at request time (which could
// introduce breaking response-shape changes later). Worth re-checking this
// against Monday's current docs periodically.
const MONDAY_API_VERSION = "2024-01";

export class MondayApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MondayApiError";
  }
}

async function graphqlRequest<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Monday's Authorization header takes the raw token, no "Bearer " prefix.
      Authorization: token,
      "API-Version": MONDAY_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = await res.json();
  if (body.errors?.length) {
    // Monday's error shape varies: GraphQL validation errors are objects
    // ({ message, locations }), but auth/authorization failures come back as
    // a bare array of strings (e.g. `{"errors":["Not Authenticated"]}`) —
    // handle both rather than assuming one shape and silently losing the
    // message (which produced empty "sync failed: " log lines during testing).
    const messages = body.errors.map((e: unknown) =>
      typeof e === "string" ? e : (e as { message?: string })?.message ?? JSON.stringify(e)
    );
    throw new MondayApiError(messages.join("; "));
  }
  if (!res.ok) {
    throw new MondayApiError(`Monday API request failed with status ${res.status}`);
  }
  return body.data as T;
}

export type MondayBoard = { id: string; name: string };

export async function listBoards(token: string): Promise<MondayBoard[]> {
  const data = await graphqlRequest<{ boards: MondayBoard[] }>(
    token,
    `query { boards(limit: 50) { id name } }`
  );
  return data.boards;
}

export type MondayColumn = { id: string; title: string; type: string };

export async function listColumns(token: string, boardId: string): Promise<MondayColumn[]> {
  const data = await graphqlRequest<{ boards: { columns: MondayColumn[] }[] }>(
    token,
    `query ($boardId: [ID!]) { boards(ids: $boardId) { columns { id title type } } }`,
    { boardId: [boardId] }
  );
  return data.boards[0]?.columns ?? [];
}

// v1 sends every mapped field as a plain string in column_values — this
// matches Monday's "text" column type cleanly. Other column types (status,
// date, dropdown, etc.) each expect their own structured JSON shape here;
// building type-aware serialization for all of them is out of scope for now
// (see the CRM Integration plan section).
export async function upsertItem(
  token: string,
  boardId: string,
  itemName: string,
  columnValues: Record<string, string>,
  existingItemId?: string | null
): Promise<string> {
  const columnValuesJson = JSON.stringify(columnValues);

  if (existingItemId) {
    const data = await graphqlRequest<{ change_multiple_column_values: { id: string } }>(
      token,
      `mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
        change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) { id }
      }`,
      { boardId, itemId: existingItemId, columnValues: columnValuesJson }
    );
    return data.change_multiple_column_values.id;
  }

  const data = await graphqlRequest<{ create_item: { id: string } }>(
    token,
    `mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
      create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) { id }
    }`,
    { boardId, itemName, columnValues: columnValuesJson }
  );
  return data.create_item.id;
}

export type MondayOAuthTokenResponse = { access_token: string };

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
  const res = await fetch("https://auth.monday.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.MONDAY_CLIENT_ID,
      client_secret: process.env.MONDAY_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code,
    }),
  });
  if (!res.ok) {
    throw new MondayApiError(`Monday token exchange failed with status ${res.status}`);
  }
  const body = (await res.json()) as MondayOAuthTokenResponse & { error?: string };
  if (!body.access_token) {
    throw new MondayApiError(body.error ?? "Monday token exchange returned no access token");
  }
  return body.access_token;
}
