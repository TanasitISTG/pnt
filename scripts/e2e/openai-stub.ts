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

  if (system.includes("dialogue-continuity analyst")) {
    return JSON.stringify({
      characters: [
        {
          sourceName: "父亲",
          targetName: "พ่อ",
          aliases: [],
          gender: "male",
          role: "father",
          notes: null,
          evidence: "父亲",
        },
        {
          sourceName: "儿子",
          targetName: "ลูกชาย",
          aliases: [],
          gender: "male",
          role: "son",
          notes: null,
          evidence: "儿子",
        },
      ],
      relationships: [
        {
          speaker: "儿子",
          listener: "父亲",
          relationship: "son",
          speakerStatus: "lower",
          familiarity: "close",
          selfPronoun: "ฉัน",
          addresseeTerm: "พ่อ",
          sentenceParticles: null,
          register: "respectful",
          notes: null,
          evidence: "儿子",
        },
      ],
      activePairs: [{ speaker: "儿子", listener: "父亲" }],
    });
  }
  if (jsonResponse || system.includes("Return ONLY a JSON object")) {
    return system.includes('single key "reviews"') ? '{"reviews":[]}' : '{"terms":[]}';
  }
  if (system.includes("chapter title")) return "ยามรุ่งอรุณ";
  if (user.includes("Please summarize this chapter")) {
    return "The son speaks to his father at dawn and promises to return.\nDIALOGUE CONTINUITY: The son addresses his father as a lower-status speaker.";
  }
  if (system.includes("novel continuity editor")) {
    return "The son promises to return after speaking respectfully to his father.";
  }

  const sourceMatch = user.match(/<<<BEGIN_TEXT>>>\s*([\s\S]*?)\s*<<<END_TEXT>>>/);
  if (sourceMatch) {
    const markerCount = (sourceMatch[1].match(/\|*\u00b6+\|*/g) ?? []).length;
    const hasFatherSon = sourceMatch[1].includes("儿子") || sourceMatch[1].includes("父亲");
    const selfPronoun = system.includes('"selfPronoun":"ผม"') ? "ผม" : "ฉัน";
    const paragraphs = hasFatherSon
      ? [`“${selfPronoun}จะกลับมา” ลูกชายบอกพ่อ`]
      : ["At dawn, Lin opened the old gate.", "Beyond it, the silent road waited."];
    return Array.from(
      { length: markerCount + 1 },
      (_, index) => paragraphs[index] ?? paragraphs[paragraphs.length - 1],
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
