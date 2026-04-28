import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { OAuth2Client } from "google-auth-library";

function requiredEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function main() {
  const clientId = requiredEnv("GOOGLEADS_OAUTH_CLIENT_ID");
  const clientSecret = requiredEnv("GOOGLEADS_OAUTH_CLIENT_SECRET");
  const redirectUri = String(process.env.GOOGLEADS_OAUTH_REDIRECT_URI || "urn:ietf:wg:oauth:2.0:oob").trim();

  const oauth2 = new OAuth2Client({ clientId, clientSecret, redirectUri });

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/adwords"],
  });

  output.write("\nOpen this URL in your browser and approve access:\n\n");
  output.write(`${url}\n\n`);

  const rl = readline.createInterface({ input, output });
  const code = (await rl.question("Paste the authorization code here: ")).trim();
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

