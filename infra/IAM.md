# Elixir Clan deployment IAM

The existing `elixir-clan-cloudformation-execution` service role may manage
IAM only for `elixir-clan-api`. Role creation and boundary attachment require
`elixir-clan-runtime-boundary`; PassRole allows that role only to Lambda.
The execution role cannot edit itself, the CI role, another role, or the boundary
policy. The CI policy and other service permissions are preserved.

CI's identity is the `elixir-clan-github-deploy` role (2026-09-26, replacing
the `elixir-clan-deploy` user's static keys): GitHub Actions assumes it with
its OIDC token, and its trust names only this repository's `production`
environment, which admits only `main`. Its one inline policy is
`elixir-clan-deployment` (`deploymentPolicyFor`). `secure-iam.mjs` verifies
its trust and policy beside the other two roles.

The boundary is an administrator-owned managed policy outside the application
stack. It caps the application's current table/index operations, log writes,
and feedback publication. Adding a runtime capability requires an administrator
to review its boundary as well as the stack's role policy. No extra stack,
identity, key, or recurring charge is introduced.

## Apply an approved correction

Use the explicitly authorized `jamie` administrator. Do not run the general
bootstrap for an IAM repair: bootstrap also handles secrets and the CI role.

```sh
node infra/scripts/secure-iam.mjs validate --profile cloud-engineer
node infra/scripts/secure-iam.mjs apply --profile cloud-engineer \
  --snapshot-dir /absolute/private/directory/outside/the/checkout
node infra/scripts/secure-iam.mjs verify --profile cloud-engineer
```

`apply` verifies the account, trusts, policy inventories, existing CI policy,
and application grants. It writes private rollback metadata before mutations,
validates the reviewed documents with Access Analyzer, installs the runtime
boundary, then restricts the execution policy. It refuses an unexpected
runtime boundary or an existing boundary document that differs from source.
It never fetches application secrets, rotates
keys, assumes an application role, or changes member data.

Install and verify the boundary **before pushing the template change**.
The template retains the boundary on subsequent CloudFormation deployments;
bootstrap uses the same reviewed documents. Run `npm run verify`, validate
the template, preview the stack change, and verify allowed and denied IAM
simulations. Deploy through main's established CI, then use the read-only
smoke and inspect the live stack, policies, private bucket controls, and alarms.
Keep the security acceptance issue open until a subsequent natural deployment
also succeeds. Do not manufacture a deployment failure or member action.

## The morning evaluation's rule (2026-09-25)

The execution policy gained one statement: the `events:*` actions a
stack needs to manage an EventBridge rule, on `rule/elixir-clan-*` only.
The runtime role and its boundary are unchanged: EventBridge invokes the
function through a resource policy the stack already may write
(`lambda:AddPermission` on `elixir-clan-*`). Apply it with the
administrator flow above (`secure-iam.mjs validate`, `apply`, `verify`),
then turn the rule on once:

```sh
AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs --skip-web \
  --param=ScheduleEnabled=true
```

Until then `ScheduleEnabled` stays `false` and the template creates no
rule, so nothing needs the new permission.

## Rollback and recovery

Keep the pre-change `before.json` outside Git. It contains policy/trust metadata,
not credential values. If application behavior fails, compare the exact denied
action/resource with the current runtime policy and reviewed cap; correct the
specific missing capability under administrator approval. For a deployment
failure, use CloudFormation's normal rollback and retain the runtime boundary.
The boundary does not remove any of the application's pre-change grants.

The snapshot can restore the previous execution inline policy with
`PutRolePolicy`, using its decoded document. That restoration reopens the
reported escalation path and requires an explicit emergency decision. Restoring
an earlier application template also requires review because it omits the
boundary property. Do not remove the boundary or restore the broad IAM family
automatically. A partial installation can safely be rerun: the installer checks
the managed policy before reuse and does not replace another boundary.
