export default {
  id: "snowflake",
  priority: 50,
  alias: "snowflake",
  display: {
    name: "Snowflake",
    icon: "smart_toy",
    color: "#0891B2",
    textIcon: "SN",
    website: "https://www.snowflake.com",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://{account}.snowflakecomputing.com/api/v2",
  },
  models: [
    { id: "llama3.1-70b", name: "llama3.1-70b" },
    { id: "llama3.3-70b", name: "llama3.3-70b" },
    { id: "deepseek-r1", name: "deepseek-r1" },
    { id: "claude-3-5-sonnet", name: "claude-3-5-sonnet" },
  ],
};

