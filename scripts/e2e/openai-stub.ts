const port = Number(process.env.E2E_OPENAI_PORT ?? "4010");

interface ChatMessage {
  role: string;
  content: string;
}

function completion(content: string) {
  return Response.json({
    id: "chatcmpl-e2e",
    object: "chat.completion",
    created: 0,
    model: "e2e-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
  });
}

function responseContent(messages: ChatMessage[], jsonResponse: boolean): string {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");
  const user = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n");

  if (jsonResponse || system.includes("Return ONLY a JSON object")) {
    return system.includes('single key "reviews"') ? '{"reviews":[]}' : '{"terms":[]}';
  }
  if (system.includes("chapter title")) return "The Open Gate";
  if (user.includes("Please summarize this chapter")) {
    return "Lin opens an old gate at dawn and finds a silent road beyond it.";
  }
  if (system.includes("novel continuity editor")) {
    return "Lin begins a journey by opening an old gate onto a silent road.";
  }

  const sourceMatch = user.match(/<<<BEGIN_TEXT>>>\s*([\s\S]*?)\s*<<<END_TEXT>>>/);
  if (sourceMatch) {
    const markerCount = (sourceMatch[1].match(/\|*\u00b6+\|*/g) ?? []).length;
    const paragraphs = ["At dawn, Lin opened the old gate.", "Beyond it, the silent road waited."];
    return Array.from(
      { length: markerCount + 1 },
      (_, index) => paragraphs[index] ?? paragraphs[1],
    ).join("\n||\u00b6||\n");
  }
  return "Hello.";
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return new Response("Not found", { status: 404 });
    }

    const body = (await request.json()) as {
      messages?: ChatMessage[];
      response_format?: { type?: string };
    };
    return completion(
      responseContent(body.messages ?? [], body.response_format?.type === "json_object"),
    );
  },
});

console.log(`OpenAI E2E stub listening on ${server.url}`);
