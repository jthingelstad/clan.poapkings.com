/**
 * Stack parameter discipline, Drop's pattern (drop.poapkings.com/infra/
 * scripts/parameters.mjs), carried here because Drop's CI once wiped a
 * parameter for lack of it.
 *
 * CloudFormation SILENTLY RESETS every parameter absent from an
 * update-stack request to its template Default. Sending a literal from
 * code is the same bug in another shape. So:
 *
 *  - REQUIRED: computed fresh on every deploy (the code key). Always sent.
 *  - PRESERVED: set once (create, or an explicit --param=Key=Value) and
 *    carried with UsePreviousValue on every later update. A preserved
 *    parameter the live stack has never carried (added to the template
 *    since the last deploy) is omitted so its Default applies, because
 *    UsePreviousValue is refused for a parameter with no previous value.
 *
 * There are no SECRET parameters: the cookie secret is a Secrets Manager
 * dynamic reference in the template, never a parameter.
 */

export const REQUIRED_PARAMETERS = ["CodeBucket", "ApiCodeKey"];

export const PRESERVED_PARAMETERS = [
  "AppUrl",
  "ElixirUrl",
  "OAuthClientId",
  "AppSecretName",
  "SiteCertificateArn",
  "MaintainerTags",
  "FeedbackNotifyEmail",
  "ElixirIntegrationKey",
  "ScheduleEnabled",
];

/**
 * @param {Record<string,string>} required values for REQUIRED_PARAMETERS
 * @param {object} opts
 * @param {boolean} opts.stackExists false on create
 * @param {Record<string,string>} [opts.overrides] explicit one-time values
 * @param {string[]|null} [opts.existingKeys] parameter keys the live stack carries
 */
export function buildParameters(
  required,
  { stackExists, overrides = {}, existingKeys = null } = {},
) {
  for (const key of REQUIRED_PARAMETERS) {
    if (required[key] === undefined || required[key] === "")
      throw new Error(`missing required parameter: ${key}`);
  }
  for (const key of Object.keys(overrides)) {
    if (!PRESERVED_PARAMETERS.includes(key))
      throw new Error(`unknown parameter override: ${key}`);
  }
  const params = REQUIRED_PARAMETERS.map((key) => ({
    ParameterKey: key,
    ParameterValue: required[key],
  }));
  for (const key of PRESERVED_PARAMETERS) {
    if (overrides[key] !== undefined) {
      params.push({
        ParameterKey: key,
        ParameterValue: String(overrides[key]),
      });
      continue;
    }
    if (!stackExists) continue; // create: the template Default, once, visibly
    const carried = !existingKeys || existingKeys.includes(key);
    if (carried) params.push({ ParameterKey: key, UsePreviousValue: true });
    // else: first deploy carrying this parameter; the Default applies.
  }
  return params;
}

export function parseOverrides(argv) {
  const overrides = {};
  for (const arg of argv) {
    if (!arg.startsWith("--param=")) continue;
    const [key, ...rest] = arg.slice("--param=".length).split("=");
    overrides[key] = rest.join("=");
  }
  return overrides;
}
