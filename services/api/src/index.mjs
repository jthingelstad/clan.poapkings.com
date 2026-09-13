/** Lambda entrypoint: real seams from the environment, nothing else. */

import { createHandler } from "./handler.mjs";
import { createMcpClient } from "./mcp.mjs";
import { createOAuthClient } from "./oauth.mjs";
import { createDynamoStore } from "./store.mjs";
import { createDynamoLedger } from "./manage/ledger.mjs";
import { createManageService, fetchParticipation } from "./manage/service.mjs";
import { createAwardsService } from "./manage/awards.mjs";
import { createRecruitService } from "./manage/recruit.mjs";
import { createScout } from "./manage/scout.mjs";
import { createFeedbackService } from "./feedback.mjs";
import { createSnsNotifier } from "./notify.mjs";

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
  awards: createAwardsService({
    ledger,
    participationFor: (token, clanTag) =>
      fetchParticipation(mcp, token, clanTag),
  }),
  scout: createScout({ mcp }),
  recruit: createRecruitService({ ledger, mcp }),
  feedback: createFeedbackService({
    ledger,
    notify: createSnsNotifier({
      topicArn: process.env.FEEDBACK_TOPIC_ARN ?? "",
      region: process.env.AWS_REGION,
      appUrl: env("APP_URL").replace(/\/$/, ""),
    }),
  }),
  maintainerTags: String(process.env.MAINTAINER_TAGS ?? "")
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t}`)),
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
