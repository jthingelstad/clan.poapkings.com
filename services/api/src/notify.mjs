/**
 * The maintainer hears about new feedback: one SNS message on the
 * stack's feedback topic, which the maintainer subscribes an address to
 * (the FeedbackNotifyEmail parameter) and the Elixir Clan agent team's
 * Close-the-Loop owner reads through the queue. Never the whole note and
 * never anything a person did not type into this product: the excerpt is
 * capped, the sender is a name and a tag.
 *
 * Unset topic = off (local runs, tests). A failure here is logged by the
 * caller and never fails the write it follows.
 */

import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";

export function createSnsNotifier({ topicArn, region, appUrl }) {
  if (!topicArn) return async () => {};
  const sns = new SNSClient({ region });
  return async (spec) => {
    const where = spec.clan_tag
      ? ` in ${spec.clan_name ? `${spec.clan_name} ${spec.clan_tag}` : spec.clan_tag}`
      : "";
    const lines = [
      `New feedback on Elixir Clan (${spec.category}) from ${spec.from}${where}.`,
      "",
      spec.excerpt,
      "",
      `Answer it: ${appUrl}/maintain/feedback/${spec.feedback_id}`,
    ];
    await sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: `Elixir Clan feedback: ${spec.category}`,
        Message: lines.join("\n"),
        MessageAttributes: {
          kind: { DataType: "String", StringValue: "feedback" },
          category: { DataType: "String", StringValue: spec.category },
          feedback_id: { DataType: "String", StringValue: spec.feedback_id },
        },
      }),
    );
  };
}
