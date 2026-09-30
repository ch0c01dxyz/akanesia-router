export default {
  id: "lambda-ai",
  priority: 50,
  alias: "lambda",
  display: {
    name: "Lambda Ai",
    icon: "smart_toy",
    color: "#0891B2",
    textIcon: "LA",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.lambda.ai/v1/chat/completions",
    validateUrl: "https://api.lambda.ai/v1/models",
  },
  models: [
    { id: "deepseek-r1-671b", name: "deepseek-r1-671b" },
    { id: "llama3.3-70b-instruct-fp8", name: "llama3.3-70b-instruct-fp8" },
    { id: "qwen25-coder-32b-instruct", name: "qwen25-coder-32b-instruct" },
  ],
};

