// bedrock — Amazon Bedrock via the native Converse / ConverseStream REST
// endpoints (OmniRoute: bedrock). Auth is AWS SigV4 (access key id + secret
// access key + optional session token); the executor signs requests itself
// with node:crypto — no @aws-sdk dependency.
export default {
  id: "bedrock",
  alias: "bedrock",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  display: {
    name: "AWS Bedrock",
    icon: "cloud",
    color: "#FF9900",
    textIcon: "BR",
    website: "https://aws.amazon.com/bedrock/",
    notice: {
      text: "Paste your AWS credentials as the API key in the form accessKeyId:secretAccessKey (optionally :sessionToken), or set awsAccessKeyId / awsSecretAccessKey / awsSessionToken in the provider's specific data. Region comes from providerSpecificData.region, or the BEDROCK_REGION / AWS_REGION env var (default us-east-1).",
      apiKeyUrl: "https://console.aws.amazon.com/iam/home#/security_credentials",
    },
  },
  transport: {
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    format: "openai",
    authHeader: "aws-sigv4",
  },
  defaultContextLength: 200000,
  models: [
    {
      id: "anthropic.claude-fable-5-1",
      name: "Claude Fable 5.1 (Bedrock)",
      toolCalling: true,
      supportsReasoning: true,
      supportedThinkingEfforts: ["low", "medium", "high", "xhigh", "max"],
      supportsXHighEffort: true,
      supportsVision: true,
      contextLength: 1000000,
      maxOutputTokens: 128000,
    },
    {
      id: "anthropic.claude-sonnet-4-6",
      name: "Claude Sonnet 4.6 (Bedrock)",
      toolCalling: true,
      supportsVision: true,
      contextLength: 1000000,
      supportsReasoning: true,
      supportedThinkingEfforts: ["low", "medium", "high", "max"],
    },
    {
      id: "anthropic.claude-sonnet-4-5",
      name: "Claude Sonnet 4.5 (Bedrock)",
      toolCalling: true,
      supportsVision: true,
      contextLength: 200000,
    },
    {
      id: "anthropic.claude-opus-4-6",
      name: "Claude Opus 4.6 (Bedrock)",
      toolCalling: true,
      supportsVision: true,
      contextLength: 1000000,
      supportsReasoning: true,
      supportedThinkingEfforts: ["low", "medium", "high", "max"],
    },
    {
      id: "anthropic.claude-opus-4-7",
      name: "Claude Opus 4.7 (Bedrock)",
      toolCalling: true,
      supportsVision: true,
      contextLength: 1000000,
      supportsReasoning: true,
      supportedThinkingEfforts: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      id: "anthropic.claude-haiku-4-5",
      name: "Claude Haiku 4.5 (Bedrock)",
      toolCalling: true,
      supportsVision: true,
    },
    { id: "openai.gpt-oss-120b-1:0", name: "GPT-OSS 120B (Bedrock)" },
  ],
  passthroughModels: true,
};
