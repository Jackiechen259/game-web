export interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

/** Exchange an OAuth code for a GitHub access token (server-side only). */
export async function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new Error(`OAuth token exchange failed: HTTP ${res.status}`);
  const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(`OAuth exchange error: ${data.error ?? "unknown"} - ${data.error_description ?? ""}`);
  }
  return data.access_token;
}

/** Fetch the authenticated GitHub user. Token stays server-side. */
export async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "game-portal-admin-api",
    },
  });
  if (!res.ok) throw new Error(`GitHub /user failed: HTTP ${res.status}`);
  const data = (await res.json()) as GithubUser;
  return data;
}
