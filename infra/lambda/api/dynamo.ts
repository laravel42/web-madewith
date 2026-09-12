/**
 * DynamoDB-backed replacement for the newsletter_subscribers/submissions
 * Postgres tables (server/src/db.ts) — same upsert semantics, no VPC/connection
 * pooling needed from Lambda.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export type SubscriptionStatus = "subscribed" | "already_subscribed" | "reactivated";

export interface NewsletterInput {
  email: string;
  scope: "network" | "domain";
  slug: string;
  created_at: string;
}

/** Table key: pk = email, sk = "<scope>#<slug>" (so one person can hold several subscriptions). */
export async function upsertNewsletterSubscriber(tableName: string, input: NewsletterInput): Promise<SubscriptionStatus> {
  const sk = `${input.scope}#${input.slug}`;
  const existing = await client.send(
    new GetCommand({ TableName: tableName, Key: { pk: input.email, sk } }),
  );

  if (!existing.Item) {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: { pk: input.email, sk, email: input.email, scope: input.scope, slug: input.slug, status: "active", created_at: input.created_at },
      }),
    );
    return "subscribed";
  }

  if (existing.Item.status === "active") return "already_subscribed";

  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: input.email, sk },
      UpdateExpression: "SET #status = :active, created_at = :createdAt REMOVE unsubscribed_at",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":active": "active", ":createdAt": input.created_at },
    }),
  );
  return "reactivated";
}

export interface SubmitInput {
  slug: string;
  repo_url: string;
  name: string;
  description: string | null;
  category: string | null;
  demo_url: string | null;
  created_at: string;
}

/** Table key: pk = a generated submission id. */
export async function insertSubmission(tableName: string, input: SubmitInput): Promise<string> {
  const id = randomUUID();
  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: { pk: id, status: "pending", ...input },
    }),
  );
  return id;
}
