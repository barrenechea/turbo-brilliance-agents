import { Plugin } from "@opencode/plugin"
import type { Context } from "@opencode/plugin/promise/plugin"
import { tagWithReason } from "./reason-tag.mjs"
import { createSlots } from "./subagent-slots.mjs"
import settings from "./settings.json" with { type: "json" }

type PluginSettings = {
  providerID?: string
  compaction?: string
  maxConcurrentSubagents?: number
  agents: Record<string, string>
}

type TextPart = { type: "text"; text: string }

type Message = { role: string; content: ReadonlyArray<{ type: string }> }

const SUBAGENT_TOOL = "subagent"

const { providerID, compaction, maxConcurrentSubagents, agents }: PluginSettings = settings

function isTextPart(part: { type: string }): part is TextPart {
  return part.type === "text"
}

function tagMessage(message: Message | undefined, reason: string) {
  const textPart = message?.content.find(isTextPart) as TextPart | undefined
  if (textPart) textPart.text = tagWithReason(textPart.text, reason)
}

async function tagRequests(ctx: Context) {
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

async function limitSubagents(ctx: Context, limit: number) {
  const slots = createSlots(limit)
  await ctx.tool.hook("execute.before", async (event) => {
    if (event.tool !== SUBAGENT_TOOL) return
    const input = event.input as { background?: boolean }
    input.background = false
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
