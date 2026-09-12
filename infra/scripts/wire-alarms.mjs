#!/usr/bin/env node
/**
 * Route the stack's alarm topic to the sysadmin projects-ops-alerts queue
 * the way elixir-mcp-alarms and elixir-drop-alarms are: add the topic ARN
 * to the queue policy's allowed sources, and subscribe with raw message
 * delivery. Idempotent; AWS_PROFILE=jamie; after the first deploy.
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
  SNSClient,
  ListSubscriptionsByTopicCommand,
  SubscribeCommand,
} from "@aws-sdk/client-sns";
import {
  SQSClient,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SetQueueAttributesCommand,
} from "@aws-sdk/client-sqs";
import { OPS_QUEUE, REGION, STACK } from "./stack.mjs";

const cfn = new CloudFormationClient({ region: REGION });
const { Stacks } = await cfn.send(
  new DescribeStacksCommand({ StackName: STACK }),
);
const topicArn = Stacks[0].Outputs.find(
  (o) => o.OutputKey === "AlarmTopicArn",
).OutputValue;

const sqs = new SQSClient({ region: REGION });
const { QueueUrl } = await sqs.send(
  new GetQueueUrlCommand({ QueueName: OPS_QUEUE }),
);
const { Attributes } = await sqs.send(
  new GetQueueAttributesCommand({
    QueueUrl,
    AttributeNames: ["Policy", "QueueArn"],
  }),
);
const policy = JSON.parse(Attributes.Policy);
const statement = policy.Statement.find((s) => s.Sid === "AllowAlarmTopics");
if (!statement)
  throw new Error(
    "queue policy has no AllowAlarmTopics statement; refusing to guess",
  );
const sources = [].concat(statement.Condition.ArnEquals["aws:SourceArn"]);
if (sources.includes(topicArn)) {
  console.log("queue policy already allows the topic");
} else {
  statement.Condition.ArnEquals["aws:SourceArn"] = [...sources, topicArn];
  await sqs.send(
    new SetQueueAttributesCommand({
      QueueUrl,
      Attributes: { Policy: JSON.stringify(policy) },
    }),
  );
  console.log(`queue policy: added ${topicArn}`);
}

const sns = new SNSClient({ region: REGION });
const { Subscriptions } = await sns.send(
  new ListSubscriptionsByTopicCommand({ TopicArn: topicArn }),
);
if (Subscriptions.some((s) => s.Endpoint === Attributes.QueueArn)) {
  console.log("subscription exists");
} else {
  await sns.send(
    new SubscribeCommand({
      TopicArn: topicArn,
      Protocol: "sqs",
      Endpoint: Attributes.QueueArn,
      Attributes: { RawMessageDelivery: "true" },
      ReturnSubscriptionArn: true,
    }),
  );
  console.log(`subscribed ${topicArn} -> ${Attributes.QueueArn} (raw)`);
}
