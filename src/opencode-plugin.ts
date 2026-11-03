import { Plugin } from "@opencode/plugin"
import type { Context } from "@opencode/plugin/promise/plugin"
import type { SessionContext } from "@opencode/plugin/promise/session"
import { tagWithReason } from "./reason-tag.ts"
import { createSlots } from "./subagent-slots.ts"
import settings from "./settings.json" with { type: "json" }

type PluginSettings = {
  providerID?: string
  compaction?: string
  maxConcurrentSubagents?: number
  agents: Record<string, string>
}

type Message = SessionContext["messages"][number]

type WritableText = { text: string }

const SUBAGENT_TOOL = "subagent"

const { providerID, compaction, maxConcurrentSubagents, agents }: PluginSettings = settings

function tagMessage(message: Message | undefined, reason: string): void {
  const textPart: WritableText | undefined = message?.content.find((part) => part.type === "text")
  if (textPart) textPart.text = tagWithReason(textPart.text, reason)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

async function tagRequests(ctx: Context): Promise<void> {
  const scope = providerID ? { providerID } : undefined
  await ctx.session.hook(
    "context",
    (event) => {
      const reason = agents[event.agent]
      if (reason) tagMessage(event.messages.find((message) => message.role === "user"), reason)
    },
    scope,
  )
  if (!compaction) return
  await ctx.session.hook(
    "compaction",
    (event) => tagMessage(event.messages.findLast((message) => message.role === "user"), compaction),
    scope,
  )
}

async function limitSubagents(ctx: Context, limit: number): Promise<void> {
  const slots = createSlots(limit)
  await ctx.tool.hook("execute.before", async (event) => {
    if (event.tool !== SUBAGENT_TOOL) return
    if (isRecord(event.input)) event.input.background = false
    await slots.acquire(event.id)
  })
  await ctx.tool.hook("execute.after", (event) => {
    if (event.tool === SUBAGENT_TOOL) slots.release(event.id)
  })
}

export default Plugin.define({
  id: "turbo-brilliance",
  async setup(ctx: Context) {
    await tagRequests(ctx)
    if (maxConcurrentSubagents) await limitSubagents(ctx, maxConcurrentSubagents)
  },
})
