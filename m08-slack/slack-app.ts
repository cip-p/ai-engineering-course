// The Slack connection that echo.ts and bot.ts share: a Bolt app in Socket Mode.
//   - The app-level token (xapp-…) opens a WebSocket to Slack. Slack pushes every event
//     down it, and Bolt acknowledges each one for you, within Slack's 3 seconds.
//   - The bot token (xoxb-…) is the bot's identity for Slack's Web API: reading channels,
//     posting replies. It can do only what the app's scopes allow (manifest.yaml).

import { App, LogLevel } from "@slack/bolt";

export function createSlackApp({ debug = false } = {}) {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: the check below says what's missing.
  }
  const token = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  if (!token || !appToken || !token.startsWith("xoxb-") || !appToken.startsWith("xapp-")) {
    console.error("Missing Slack tokens: put SLACK_BOT_TOKEN=xoxb-… and SLACK_APP_TOKEN=xapp-… in .env (Module 8 setup, step 5).");
    process.exit(1);
  }
  // DEBUG prints every message on the WebSocket: the events Slack sends, and the acks.
  return new App({ token, appToken, socketMode: true, logLevel: debug ? LogLevel.DEBUG : LogLevel.WARN });
}
