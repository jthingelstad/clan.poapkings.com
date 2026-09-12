/** Names shared by every script. One place, so a rename is one edit. */
export const REGION = process.env.AWS_REGION ?? "us-east-1";
export const STACK = process.env.ELIXIR_CLAN_STACK_NAME ?? "elixir-clan";
export const SECRET_NAME = "elixir-clan/app";
export const CI_USER = "elixir-clan-deploy";
export const CFN_ROLE = "elixir-clan-cloudformation-execution";
export const OPS_QUEUE = "projects-ops-alerts";
export const codeBucketFor = (accountId) => `elixir-clan-code-${accountId}`;
export const webBucketFor = (accountId) => `elixir-clan-web-${accountId}`;
