/** Names shared by every script. One place, so a rename is one edit. */
export const REGION = process.env.AWS_REGION ?? "us-east-1";
export const STACK = process.env.ELIXIR_CLAN_STACK_NAME ?? "elixir-clan";
export const SECRET_NAME = "elixir-clan/app";
export const GITHUB_REPO = "jthingelstad/clan.poapkings.com";
/** CI's identity since 2026-09-26: GitHub's OIDC token for this repo's
 *  `production` environment, never a stored key. */
export const DEPLOY_ROLE = "elixir-clan-github-deploy";
export const CFN_ROLE = "elixir-clan-cloudformation-execution";
export const OPS_QUEUE = "projects-ops-alerts";
export const codeBucketFor = (accountId) => `elixir-clan-code-${accountId}`;
export const webBucketFor = (accountId) => `elixir-clan-web-${accountId}`;
/** The account tag standard (projects-sysadmin docs/AWS-TAGS.md). The stack
 *  carries these and CloudFormation propagates them to every resource it
 *  owns; what bootstrap creates outside it says ManagedBy=repository. */
export const tagsFor = (managedBy) => [
  { Key: "Application", Value: "Elixir" },
  { Key: "Project", Value: "elixir-clan" },
  { Key: "Environment", Value: "production" },
  { Key: "Repository", Value: "jthingelstad/clan.poapkings.com" },
  { Key: "ManagedBy", Value: managedBy },
];
