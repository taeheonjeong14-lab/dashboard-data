import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { OAuth2Client } from "google-auth-library";

function requiredEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/** Accept raw auth code or full redirect URL (?code=...). */
function extractAuthCode(raw) {
  const s = String(raw || "").trim();
  const fromQuery = s.match(/[?&]code=([^&]+)/);
  if (fromQuery) return decodeURIComponent(fromQuery[1]);
  return s;
}

async function main() {
  const clientId = requiredEnv("GOOGLEADS_OAUTH_CLIENT_ID");
  const clientSecret = requiredEnv("GOOGLEADS_OAUTH_CLIENT_SECRET");
  // GCP no longer allows urn:ietf:wg:oauth:2.0:oob ("must contain a domain").
  // Add this exact URI under OAuth client → Authorized redirect URIs.
  const redirectUri = String(
    process.env.GOOGLEADS_OAUTH_REDIRECT_URI || "http://127.0.0.1:8085/oauth2callback",
  ).trim();

  const oauth2 = new OAuth2Client({ clientId, clientSecret, redirectUri });

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/adwords"],
  });

  output.write("\nOpen this URL in your browser and approve access:\n\n");
  output.write(`${url}\n\n`);
  output.write(
    "After login, the browser may show a connection error (nothing listens on localhost).\n" +
      "That is OK — copy either the `code` value or the full address bar URL here.\n\n",
  );

  const rl = readline.createInterface({ input, output });
  const code = extractAuthCode(await rl.question("Paste the authorization code or full redirect URL: "));
  rl.close();

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("No refresh_token returned. Try again with prompt=consent and a fresh account consent.");
  }

  output.write("\nRefresh token (store securely; can be saved as enc::...):\n\n");
  output.write(`${tokens.refresh_token}\n`);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

