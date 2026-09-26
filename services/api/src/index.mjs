/** Lambda entrypoint: real seams from the environment, nothing else. */

import { createHandler } from "./handler.mjs";
import { createElixirApiClient } from "./elixir-api.mjs";
import { createOAuthClient } from "./oauth.mjs";
import { createDynamoStore } from "./store.mjs";
import { createDynamoLedger } from "./manage/ledger.mjs";
import {
  createManageService,
  fetchParticipation,
  fetchRoster,
} from "./manage/service.mjs";
import { createAwardsService } from "./manage/awards.mjs";
import { createRecruitService } from "./manage/recruit.mjs";
import { createModelService } from "./manage/model.mjs";
import { createAnthropicClient } from "./anthropic.mjs";
import { createScheduledRun } from "./scheduled.mjs";
import { createDrafts } from "./manage/drafts.mjs";
import { createScout } from "./manage/scout.mjs";
import { createFeedbackService } from "./feedback.mjs";
import { createSocialService } from "./manage/social.mjs";
import { diskGeo } from "./geo.mjs";
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

// Clan reads Elixir through the JSON API (/api/v1), not MCP (2026-09-23).
// The client keeps the MCP client's interface, so every caller is as it was.
const mcp = createElixirApiClient({ url: elixirUrl });
const ledger = createDynamoLedger({
  tableName: env("TABLE_NAME"),
  region: process.env.AWS_REGION,
});

// The clan's own model, on the clan's own Anthropic key (never ours). Its
// key is sealed under a key derived from the app's secret.
const model = createModelService({
  ledger,
  anthropic: createAnthropicClient(),
  secret: env("SESSION_SECRET"),
  rosterFor: (token, clanTag) => fetchRoster(mcp, token, clanTag),
});

const manage = createManageService({
  ledger,
  mcp,
  appUrl: env("APP_URL").replace(/\/$/, ""),
});
const awards = createAwardsService({
  ledger,
  participationFor: (token, clanTag) => fetchParticipation(mcp, token, clanTag),
  elixir: mcp,
});

// The morning evaluation, on Clan's own Elixir integration key (door 1).
const scheduled = createScheduledRun({
  ledger,
  manage,
  awards,
  integrationKey: process.env.ELIXIR_INTEGRATION_KEY ?? "",
});

const http = createHandler({
  mcp,
  model,
  drafts: createDrafts({ ledger, model }),
  manage,
  awards,
  scout: createScout({ mcp }),
  recruit: createRecruitService({ ledger, mcp, model }),
  // Social (2026-09-26): the clan map, on the place lists beside the bundle.
  social: createSocialService({ ledger, geo: diskGeo() }),
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
    // The grant is for the JSON API; an MCP grant is refused there.
    resource: `${elixirUrl}/api/v1`,
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

/** One function: HTTP from the API, and the daily rule's event, which
 *  no HTTP request can produce (API Gateway's event has its own shape). */
export const handler = (event, context) =>
  event?.scheduled === "evaluate" ? scheduled() : http(event, context);
