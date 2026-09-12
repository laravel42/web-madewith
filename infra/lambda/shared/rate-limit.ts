/**
 * Per-IP daily rate limiting on DynamoDB — replaces the Redis `incr`+`expire`
 * pattern from server/src/kv.ts. One item per (ip, day); TTL cleans up the
 * table automatically instead of an explicit EXPIRE.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const TTL_SECONDS = 60 * 60 * 26; // a day plus slack, mirrors the Redis TTL

/** Atomically increments today's counter for this ip+scope and returns the new total. */
export async function incrementRateLimit(tableName: string, scope: string, ip: string, day: string): Promise<number> {
  const result = await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: `${scope}#${ip}#${day}` },
      UpdateExpression: "ADD #count :one SET expires_at = if_not_exists(expires_at, :expiresAt)",
      ExpressionAttributeNames: { "#count": "count" },
      ExpressionAttributeValues: {
        ":one": 1,
        ":expiresAt": Math.floor(Date.now() / 1000) + TTL_SECONDS,
      },
      ReturnValues: "UPDATED_NEW",
    }),
  );
  return Number(result.Attributes?.count ?? 0);
}

export async function isRateLimited(tableName: string, scope: string, ip: string, day: string, limit: number): Promise<boolean> {
  const n = await incrementRateLimit(tableName, scope, ip, day);
  return n > limit;
}
