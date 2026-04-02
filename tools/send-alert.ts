import { tool } from "@opencode-ai/plugin"
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"

export default tool({
  description:
    "Send a notification alert via webhook (Slack, Discord, or generic). Reads webhook URL from config file.",
  args: {
    message: tool.schema.string().describe("Alert message to send"),
    channel: tool.schema
      .string()
      .optional()
      .default("default")
      .describe("Channel name: 'slack', 'discord', or 'default'"),
    level: tool.schema
      .string()
      .optional()
      .default("info")
      .describe("Alert level: 'info', 'warning', 'critical'"),
  },
  async execute(args) {
    const configPath = join(
      homedir(),
      ".config",
      "opencode",
      ".secrets",
      "webhooks.json",
    )

    if (!existsSync(configPath)) {
      return JSON.stringify({
        status: "error",
        message:
          "Webhook config not found. Create ~/.config/opencode/.secrets/webhooks.json with: { \"slack\": \"https://hooks.slack.com/...\", \"discord\": \"https://discord.com/api/webhooks/...\" }",
      })
    }

    let webhooks: Record<string, string>
    try {
      webhooks = JSON.parse(readFileSync(configPath, "utf-8"))
    } catch {
      return JSON.stringify({
        status: "error",
        message: "Invalid webhook config JSON",
      })
    }

    const webhookUrl = webhooks[args.channel] || webhooks["default"]
    if (!webhookUrl) {
      return JSON.stringify({
        status: "error",
        message: `No webhook URL found for channel '${args.channel}'. Available: ${Object.keys(webhooks).join(", ")}`,
      })
    }

    const emoji =
      args.level === "critical"
        ? "🚨"
        : args.level === "warning"
          ? "⚠️"
          : "ℹ️"

    const payload =
      args.channel === "slack"
        ? { text: `${emoji} ${args.message}` }
        : args.channel === "discord"
          ? { content: `${emoji} ${args.message}` }
          : { message: args.message, level: args.level }

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        return JSON.stringify({
          status: "sent",
          channel: args.channel,
          level: args.level,
        })
      } else {
        return JSON.stringify({
          status: "error",
          message: `HTTP ${response.status}: ${await response.text()}`,
        })
      }
    } catch (err) {
      return JSON.stringify({ status: "error", message: String(err) })
    }
  },
})
