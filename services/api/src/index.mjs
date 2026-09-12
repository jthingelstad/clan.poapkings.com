/** Lambda entrypoint: real seams from the environment, nothing else. */

import { createHandler } from "./handler.mjs";
import { createMcpClient } from "./mcp.mjs";
import { createOAuthClient } from "./oauth.mjs";
import { createDynamoStore } from "./store.mjs";
import { createDynamoLedger } from "./manage/ledger.mjs";
import { createManageService } from "./manage/service.mjs";
import { createScout } from "./manage/scout.mjs";

const env = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing env ${name}`);
  }
  return v;
};

const elixirUrl = env("ELIXIR_URL", "https://elixir.poapkings.com").replace(
  /\/$/,
  "",
);

const mcp = createMcpClient({ url: `${elixirUrl}/mcp` });
const ledger = createDynamoLedger({
  tableName: env("TABLE_NAME"),
  region: process.env.AWS_REGION,
});

export const handler = createHandler({
  mcp,
  manage: createManageService({ ledger, mcp }),
  scout: createScout({ mcp }),
  oauth: createOAuthClient({
    issuer: elixirUrl,
    resource: `${elixirUrl}/mcp`,
    clientId: process.env.OAUTH_CLIENT_ID ?? "",
  }),
  store: createDynamoStore({
    tableName: env("TABLE_NAME"),
    region: process.env.AWS_REGION,
  }),
  sessionSecret: env("SESSION_SECRET"),
  appUrl: env("APP_URL").replace(/\/$/, ""),
  elixirUrl,
});
