/** Administrator-owned IAM documents shared by bootstrap and independent verification. */
import {
  CFN_ROLE,
  REGION,
  SECRET_NAME,
  STACK,
  codeBucketFor,
  webBucketFor,
} from "./stack.mjs";
export const RUNTIME_ROLE = "elixir-clan-api";
export const BOUNDARY_NAME = "elixir-clan-runtime-boundary";
export const EXECUTION_POLICY = "elixir-clan-stack-management";
export const boundaryArnFor = (accountId) =>
  `arn:aws:iam::${accountId}:policy/${BOUNDARY_NAME}`;
export const runtimeRoleArnFor = (accountId) =>
  `arn:aws:iam::${accountId}:role/${RUNTIME_ROLE}`;
export function executionPolicyFor(accountId) {
  const codeBucket = codeBucketFor(accountId);
  const webBucket = webBucketFor(accountId);
  const policy = {
    Version: "2012-10-17",
    Statement: [
      // API Gateway control-plane ARNs are not name-scoped; CloudFront
      // create/list are account-global. Everything regional is pinned
      // to elixir-clan-* names.
      { Effect: "Allow", Action: ["apigateway:*"], Resource: "*" },
      {
        Effect: "Allow",
        Action: [
          "cloudfront:CreateDistribution",
          "cloudfront:CreateFunction",
          "cloudfront:CreateOriginAccessControl",
          "cloudfront:CreateOriginRequestPolicy",
          "cloudfront:CreateResponseHeadersPolicy",
          "cloudfront:DeleteDistribution",
          "cloudfront:DeleteFunction",
          "cloudfront:DeleteOriginAccessControl",
          "cloudfront:DeleteOriginRequestPolicy",
          "cloudfront:DeleteResponseHeadersPolicy",
          "cloudfront:DescribeFunction",
          "cloudfront:GetDistribution",
          "cloudfront:GetDistributionConfig",
          "cloudfront:GetFunction",
          "cloudfront:GetOriginAccessControl",
          "cloudfront:GetOriginAccessControlConfig",
          "cloudfront:GetOriginRequestPolicy",
          "cloudfront:GetOriginRequestPolicyConfig",
          "cloudfront:GetResponseHeadersPolicy",
          "cloudfront:GetResponseHeadersPolicyConfig",
          "cloudfront:ListDistributions",
          "cloudfront:ListFunctions",
          "cloudfront:ListOriginAccessControls",
          "cloudfront:ListOriginRequestPolicies",
          "cloudfront:ListResponseHeadersPolicies",
          "cloudfront:ListTagsForResource",
          "cloudfront:PublishFunction",
          "cloudfront:TagResource",
          "cloudfront:UntagResource",
          "cloudfront:UpdateDistribution",
          "cloudfront:UpdateFunction",
          "cloudfront:UpdateOriginAccessControl",
          "cloudfront:UpdateOriginRequestPolicy",
          "cloudfront:UpdateResponseHeadersPolicy",
        ],
        Resource: "*",
      },
      {
        Effect: "Allow",
        Action: ["acm:DescribeCertificate"],
        Resource: `arn:aws:acm:us-east-1:${accountId}:certificate/*`,
      },
      {
        Effect: "Allow",
        Action: ["cloudwatch:*"],
        Resource: `arn:aws:cloudwatch:${REGION}:${accountId}:alarm:elixir-clan-*`,
      },
      {
        Effect: "Allow",
        Action: ["dynamodb:*"],
        Resource: `arn:aws:dynamodb:${REGION}:${accountId}:table/elixir-clan*`,
      },
      {
        Effect: "Allow",
        Action: ["lambda:*"],
        Resource: `arn:aws:lambda:${REGION}:${accountId}:function:elixir-clan-*`,
      },
      {
        Effect: "Allow",
        Action: ["logs:*"],
        Resource: [
          `arn:aws:logs:${REGION}:${accountId}:log-group:/aws/lambda/elixir-clan-*`,
          // The HTTP API's access log (2026-09-12).
          `arn:aws:logs:${REGION}:${accountId}:log-group:/aws/apigateway/elixir-clan-*`,
        ],
      },
      {
        Effect: "Allow",
        Action: ["logs:DescribeLogGroups"],
        Resource: "*",
      },
      {
        // Vended logs: what API Gateway needs to write an HTTP API's
        // access log to a log group. Resource-less by AWS's design.
        Effect: "Allow",
        Action: [
          "logs:CreateLogDelivery",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
        ],
        Resource: "*",
      },
      {
        Effect: "Allow",
        Action: ["sns:*"],
        Resource: `arn:aws:sns:${REGION}:${accountId}:elixir-clan-*`,
      },
      {
        // The morning evaluation's rule (2026-09-25, door 1): the stack
        // manages only its own elixir-clan-* rules.
        Effect: "Allow",
        Action: [
          "events:DescribeRule",
          "events:PutRule",
          "events:DeleteRule",
          "events:EnableRule",
          "events:DisableRule",
          "events:PutTargets",
          "events:RemoveTargets",
          "events:ListTargetsByRule",
          "events:TagResource",
          "events:UntagResource",
          "events:ListTagsForResource",
        ],
        Resource: `arn:aws:events:${REGION}:${accountId}:rule/elixir-clan-*`,
      },
      {
        Effect: "Allow",
        Action: ["s3:*"],
        Resource: [`arn:aws:s3:::${webBucket}`, `arn:aws:s3:::${webBucket}/*`],
      },
      {
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:GetObjectVersion"],
        Resource: `arn:aws:s3:::${codeBucket}/*`,
      },

      // The template's {{resolve:secretsmanager}} is resolved by
      // CloudFormation under this role, never by a person or agent.
      {
        Effect: "Allow",
        Action: ["secretsmanager:GetSecretValue"],
        Resource: `arn:aws:secretsmanager:${REGION}:${accountId}:secret:${SECRET_NAME}-*`,
      },
    ],
  };
  policy.Statement.push(
    {
      Effect: "Allow",
      Action: [
        "iam:GetRole",
        "iam:GetRolePolicy",
        "iam:ListAttachedRolePolicies",
        "iam:ListRolePolicies",
        "iam:DeleteRole",
        "iam:DeleteRolePolicy",
        "iam:PutRolePolicy",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:UpdateAssumeRolePolicy",
      ],
      Resource: runtimeRoleArnFor(accountId),
    },
    {
      Effect: "Allow",
      Action: ["iam:CreateRole", "iam:PutRolePermissionsBoundary"],
      Resource: runtimeRoleArnFor(accountId),
      Condition: {
        StringEquals: { "iam:PermissionsBoundary": boundaryArnFor(accountId) },
      },
    },
    {
      Effect: "Allow",
      Action: "iam:PassRole",
      Resource: runtimeRoleArnFor(accountId),
      Condition: {
        StringEquals: { "iam:PassedToService": "lambda.amazonaws.com" },
      },
    },
    {
      Effect: "Allow",
      Action: ["iam:GetPolicy", "iam:GetPolicyVersion"],
      Resource: boundaryArnFor(accountId),
    },
  );
  return policy;
}
export function runtimeBoundaryFor(accountId) {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
        Resource: `arn:aws:logs:${REGION}:${accountId}:log-group:/aws/lambda/${RUNTIME_ROLE}:*`,
      },
      {
        Effect: "Allow",
        Action: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:BatchWriteItem",
        ],
        Resource: [
          `arn:aws:dynamodb:${REGION}:${accountId}:table/elixir-clan`,
          `arn:aws:dynamodb:${REGION}:${accountId}:table/elixir-clan/index/ByClan`,
        ],
      },
      {
        Effect: "Allow",
        Action: "sns:Publish",
        Resource: `arn:aws:sns:${REGION}:${accountId}:elixir-clan-feedback`,
      },
    ],
  };
}
export const trustFor = (service) => ({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: { Service: service },
      Action: "sts:AssumeRole",
    },
  ],
});
export const executionRoleArnFor = (accountId) =>
  `arn:aws:iam::${accountId}:role/${CFN_ROLE}`;

export function deploymentPolicyFor(accountId) {
  const codeBucket = codeBucketFor(accountId);
  const webBucket = webBucketFor(accountId);
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "cloudformation:CreateStack",
          "cloudformation:DescribeStackEvents",
          "cloudformation:DescribeStacks",
          "cloudformation:UpdateStack",
        ],
        Resource: `arn:aws:cloudformation:${REGION}:${accountId}:stack/${STACK}/*`,
      },
      {
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:ListBucket", "s3:PutObject"],
        Resource: [
          `arn:aws:s3:::${codeBucket}`,
          `arn:aws:s3:::${codeBucket}/*`,
        ],
      },
      {
        Effect: "Allow",
        Action: [
          "s3:DeleteObject",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:PutObject",
        ],
        Resource: [`arn:aws:s3:::${webBucket}`, `arn:aws:s3:::${webBucket}/*`],
      },
      {
        Effect: "Allow",
        Action: ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
        Resource: `arn:aws:cloudfront::${accountId}:distribution/*`,
      },
      {
        Effect: "Allow",
        Action: "iam:PassRole",
        Resource: executionRoleArnFor(accountId),
        Condition: {
          StringEquals: {
            "iam:PassedToService": "cloudformation.amazonaws.com",
          },
        },
      },
    ],
  };
}
