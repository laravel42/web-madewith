import { Stack, StackProps, Duration, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwIntegrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";

export interface ApiStackProps extends StackProps {
  /** Public origin the chat Lambda fetches llms.txt/RSS context from. */
  siteOrigin: string;
  /** PostHog project token/host for server-side capture — same values as PUBLIC_POSTHOG_* in the site's .env. */
  posthogProjectToken?: string;
  posthogHost?: string;
  /** OpenAI key for the chat Lambda. */
  openaiApiKey?: string;
  chatModel?: string;
  /**
   * Shared secret CloudFront sends as a custom origin header
   * (workers/utils/cloudfront/add_api_origins.py) and the chat Lambda checks
   * on every request. Origin Access Control (SigV4) on a Lambda Function URL
   * with InvokeMode RESPONSE_STREAM never reached the function in testing —
   * CloudFront returned 403 before invocation despite a correct resource
   * policy (both lambda:InvokeFunctionUrl and lambda:InvokeFunction granted,
   * scoped by SourceArn and SourceAccount) — so the Function URL is public
   * (AuthType NONE) and this header is the actual access control.
   */
  chatOriginSecret: string;
}

// Repo root also has a stray package-lock.json alongside pnpm-lock.yaml, which
// confuses NodejsFunction's lockfile auto-detection — point it at the real one.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEPS_LOCK_FILE_PATH = join(REPO_ROOT, "pnpm-lock.yaml");

export class ApiStack extends Stack {
  /** For wiring into CloudFront as a second origin (see infra/README.md). */
  public readonly httpApiUrl: string;
  public readonly chatFunctionUrl: string;
  public readonly chatFunctionArn: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // --- Data --------------------------------------------------------------
    // On-demand billing: this is a low-traffic public form backend, not worth
    // provisioning/managing capacity for.
    const newsletterTable = new dynamodb.TableV2(this, "NewsletterSubscribers", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING }, // email
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING }, // "<scope>#<slug>"
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const submissionsTable = new dynamodb.TableV2(this, "Submissions", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING }, // submission id
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const rateLimitTable = new dynamodb.TableV2(this, "RateLimits", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING }, // "<scope>#<ip>#<day>"
      timeToLiveAttribute: "expires_at",
      removalPolicy: RemovalPolicy.DESTROY, // pure rate-limit counters, safe to lose
    });

    // --- Newsletter + submit: API Gateway HTTP API → Lambda -----------------
    const apiFn = new lambdaNodejs.NodejsFunction(this, "ApiFn", {
      entry: "lambda/api/index.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      depsLockFilePath: DEPS_LOCK_FILE_PATH,
      environment: {
        NEWSLETTER_TABLE: newsletterTable.tableName,
        SUBMISSIONS_TABLE: submissionsTable.tableName,
        RATE_LIMIT_TABLE: rateLimitTable.tableName,
        POSTHOG_PROJECT_TOKEN: props.posthogProjectToken ?? "",
        POSTHOG_HOST: props.posthogHost ?? "",
      },
      bundling: { minify: true, sourceMap: true },
    });
    newsletterTable.grantReadWriteData(apiFn);
    submissionsTable.grantReadWriteData(apiFn);
    rateLimitTable.grantReadWriteData(apiFn);

    const httpApi = new apigwv2.HttpApi(this, "PublicApi", {
      description: "MadeWithWhat public form API (newsletter, submit)",
    });
    const apiIntegration = new apigwIntegrations.HttpLambdaIntegration("ApiIntegration", apiFn);
    httpApi.addRoutes({ path: "/api/newsletter", methods: [apigwv2.HttpMethod.POST], integration: apiIntegration });
    httpApi.addRoutes({ path: "/api/submit", methods: [apigwv2.HttpMethod.POST], integration: apiIntegration });

    // --- Chat: streaming Lambda Function URL (API Gateway buffers responses,
    // so it can't carry SSE) -------------------------------------------------
    const chatFn = new lambdaNodejs.NodejsFunction(this, "ChatFn", {
      entry: "lambda/chat/index.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(60),
      depsLockFilePath: DEPS_LOCK_FILE_PATH,
      environment: {
        RATE_LIMIT_TABLE: rateLimitTable.tableName,
        SITE_ORIGIN: props.siteOrigin,
        OPENAI_API_KEY: props.openaiApiKey ?? "",
        CHAT_MODEL: props.chatModel ?? "gpt-4o-mini",
        CHAT_ORIGIN_SECRET: props.chatOriginSecret,
      },
      bundling: { minify: true, sourceMap: true },
    });
    rateLimitTable.grantReadWriteData(chatFn);

    // Public (NONE), gated by the CHAT_ORIGIN_SECRET header the Lambda checks
    // on every request — see the ApiStackProps.chatOriginSecret doc comment
    // for why OAC/SigV4 isn't used here.
    const chatFnUrl = chatFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      cors: undefined, // same-origin via the CloudFront behavior; no cross-origin caller
    });

    // Both actions, both required for Function URL invocation even at
    // AuthType=NONE (see aws-serverless skill's lambda.md) — scoped to
    // "invoked via a function URL" so this doesn't also open direct
    // lambda:Invoke access to the world.
    chatFn.addPermission("AllowPublicInvokeUrl", {
      principal: new iam.AnyPrincipal(),
      action: "lambda:InvokeFunctionUrl",
      functionUrlAuthType: lambda.FunctionUrlAuthType.NONE,
    });
    chatFn.addPermission("AllowPublicInvokeFunction", {
      principal: new iam.AnyPrincipal(),
      action: "lambda:InvokeFunction",
      invokedViaFunctionUrl: true,
    });

    this.httpApiUrl = httpApi.url!;
    this.chatFunctionUrl = chatFnUrl.url;
    this.chatFunctionArn = chatFn.functionArn;

    new CfnOutput(this, "HttpApiUrl", { value: httpApi.url! });
    new CfnOutput(this, "ChatFunctionUrl", { value: chatFnUrl.url });
    new CfnOutput(this, "ChatFunctionArn", { value: chatFn.functionArn });
    new CfnOutput(this, "NewsletterTableName", { value: newsletterTable.tableName });
    new CfnOutput(this, "SubmissionsTableName", { value: submissionsTable.tableName });
    new CfnOutput(this, "RateLimitTableName", { value: rateLimitTable.tableName });
  }
}
