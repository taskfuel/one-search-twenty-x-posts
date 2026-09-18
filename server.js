// One question, up to twenty X posts, in full.
//
// Ask in plain English. A model turns the question into an X search query, then
// the search runs. Both calls go through the TaskFuel gateway, which pays the
// upstream and bills your prepaid balance. You need one key, not an X developer
// account and a model provider account.
// Docs: https://app.taskfuel.ai/building-apps.md

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const PORT = process.env.PORT || 3000;
const KEY = process.env.TASKFUEL_API_KEY;
const GATEWAY = "https://app.taskfuel.ai/v1/call";

// X search. One call returns up to 20 matching posts, newest first.
const SEARCH_URL = "https://x402.ottoai.services/tweet-search";

// The model that writes the search query. Any of the catalog's 78 models works
// here. This one is cheap, fast, and does not think out loud before answering,
// which matters: a reasoning model spends its output budget on thinking and can
// return nothing at all under a low max_tokens.
const CHAT_URL = "https://blockrun.ai/api/v1/chat/completions";
const MODEL = process.env.QUERY_MODEL || "anthropic/claude-haiku-4.5";

// Guardrails. The key can spend the whole balance and nobody is watching at
// call time, so the limits live in the code. See "Spending safely" in
// https://app.taskfuel.ai/building-apps.md
const MAX_USD_PER_SEARCH = Number(process.env.MAX_USD_PER_SEARCH || 0.02);
const MAX_USD_PER_QUERY = Number(process.env.MAX_USD_PER_QUERY || 0.01);
const DAILY_BUDGET_USD = Number(process.env.DAILY_BUDGET_USD || 1.0);

const EXAMPLES = [
  { label: "One person's timeline", question: "What has Andrej Karpathy been posting lately?" },
  { label: "A phrase, two ways", question: "Find people saying their agent bought something on its own." },
  { label: "Mentions of an account", question: "Find the last 20 Tweets that mentioned @taskfuelai." },
  { label: "A ticker", question: "What are people saying about $BTC right now?" },
];

// Short, strict, and carrying its own examples. Without the "smallest query"
// rule, models pad a simple request with a dozen synonyms and the search stops
// matching anything useful.
const QUERY_SYSTEM = `You turn a request into one X (Twitter) search query. Reply with the query and nothing else.

Rules:
- Use the smallest query that answers the request. Do not pad it with synonyms.
- from:handle for one persons posts. @handle for mentions of an account. $TICKER for a ticker.
- "quoted phrase" for exact wording. OR between alternatives. -term to exclude.
- Never invent a handle. If the request names one, use it exactly as given.
- Results are at most the 20 newest matches, so ignore any request for a count or a date range.

Examples:
Request: Find the last 20 Tweets that mentioned @taskfuelai.
Query: @taskfuelai
Request: What has Andrej Karpathy been posting?
Query: from:karpathy
Request: People saying their agent bought something on its own
Query: "my agent bought" OR "agent paid for it itself"`;

let spentToday = 0;
let budgetDay = new Date().toISOString().slice(0, 10);

function budgetLeft() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== budgetDay) {
    budgetDay = today;
    spentToday = 0;
  }
  return DAILY_BUDGET_USD - spentToday;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Post text arrives HTML-escaped, so "Q&A" comes over the wire as "Q&amp;A".
// The words are the provider's, unchanged; only the escaping is undone.
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const unescapeHtml = (s) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });

/** Call through the gateway. Returns the upstream body plus what it charged. */
async function gateway({ url, method = "GET", body, maxAmountUsd }) {
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, method, body, maxAmountUsd }),
  });

  const cost = Number(res.headers.get("x-taskfuel-cost") || 0);
  const balance = res.headers.get("x-taskfuel-balance");
  const requestId = res.headers.get("x-taskfuel-request-id");
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const detail = data?.error || data?.message || text.slice(0, 200);
    const err = new Error(`gateway ${res.status}: ${detail}`);
    err.status = res.status;
    // The gateway tells you how long to wait. Honour it rather than guessing.
    err.retryAfterSeconds = Number(data?.retry_after_seconds) || 10;
    throw err;
  }
  return { data, cost, balance, requestId };
}

/** Retry only on 429, which is free: the gateway rate-limits before it pays. */
async function withRetry(call) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (err.status !== 429 || attempt >= 2) throw err;
      await sleep(err.retryAfterSeconds * 1000);
    }
  }
}

/** Paid: turn a plain English question into an X search query. */
async function writeQuery(question) {
  const result = await withRetry(() =>
    gateway({
      url: CHAT_URL,
      method: "POST",
      body: {
        model: MODEL,
        messages: [
          { role: "system", content: QUERY_SYSTEM },
          { role: "user", content: `Request: ${question}\nQuery:` },
        ],
        max_tokens: 120,
        temperature: 0,
      },
      maxAmountUsd: MAX_USD_PER_QUERY,
    }),
  );

  spentToday += result.cost;

  // A model can answer with an empty string and still charge for it, so treat a
  // blank query as a failure rather than searching X for nothing.
  const query = (result.data?.choices?.[0]?.message?.content || "").trim().replace(/^["']|["']$/g, "");
  if (!query) throw new Error("the model returned an empty query. Try rephrasing the question.");

  return { query, cost: result.cost };
}

/** Paid: run one search. The price is per call, not per post returned. */
async function search(question) {
  // Both calls have to fit, or the first one is paid for and the second fails.
  if (budgetLeft() < MAX_USD_PER_SEARCH + MAX_USD_PER_QUERY) {
    throw new Error(
      `daily budget of $${DAILY_BUDGET_USD.toFixed(2)} reached. Raise DAILY_BUDGET_USD to continue.`,
    );
  }

  const written = await writeQuery(question);
  const query = written.query;

  const result = await withRetry(() =>
    gateway({
      url: `${SEARCH_URL}?query=${encodeURIComponent(query)}`,
      method: "GET",
      maxAmountUsd: MAX_USD_PER_SEARCH,
    }),
  );

  spentToday += result.cost;

  const posts = (result.data?.data?.tweets || result.data?.tweets || []).map((t) => ({
    author: t.author,
    text: unescapeHtml(t.text ?? ""),
    url: t.url,
    createdAt: t.createdAt,
    likes: t.likes ?? 0,
    retweets: t.retweets ?? 0,
    replies: t.replies ?? 0,
    quotes: t.quotes ?? 0,
    // The endpoint flags long-form posts, the ones that run past the old
    // character limit. They are the reason to read the text rather than a
    // preview: a truncated argument reads as a complete one.
    longForm: Boolean(t.isLongForm),
    characters: (t.text ?? "").length,
  }));

  return {
    question,
    query,
    posts,
    queryCost: written.cost,
    searchCost: result.cost,
    cost: written.cost + result.cost,
    balance: result.balance,
    requestId: result.requestId,
    spentToday,
    budget: DAILY_BUDGET_USD,
  };
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function handle(req, res) {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const html = await readFile(new URL("./public/index.html", import.meta.url));
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(html);
  }

  if (req.method === "GET" && req.url === "/api/config") {
    return json(res, 200, { examples: EXAMPLES, hasKey: Boolean(KEY), model: MODEL });
  }

  if (req.method === "POST" && req.url === "/api/search") {
    if (!KEY) {
      return json(res, 500, {
        error: "No TASKFUEL_API_KEY set. Add it as a secret, then start the app again.",
      });
    }

    let payload = "";
    for await (const chunk of req) payload += chunk;

    let question;
    try {
      ({ question } = JSON.parse(payload));
    } catch {
      return json(res, 400, { error: "bad JSON" });
    }

    if (!question?.trim()) return json(res, 400, { error: "question is required" });

    try {
      return json(res, 200, await search(question.trim()));
    } catch (err) {
      return json(res, 502, { error: String(err.message || err) });
    }
  }

  res.writeHead(404);
  res.end("not found");
}

const server = createServer((req, res) => {
  req.on("error", () => {});
  res.on("error", () => {});

  handle(req, res).catch((err) => {
    if (err?.code === "ECONNRESET" || err?.message === "aborted") return; // client went away
    console.error("request failed:", err?.message || err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal error" }));
    }
  });
});

server.on("clientError", (_err, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

process.on("unhandledRejection", (err) => {
  console.error("unhandled rejection:", err?.message || err);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  X search running on port ${PORT}`);
  if (!KEY) {
    console.log("  No TASKFUEL_API_KEY yet. Add it as a secret, then start the app again.");
    console.log("  On Replit: the Agent asks for it, or add it in the Secrets tool.");
    console.log("  Get a key at https://app.taskfuel.ai (first $5 is free).\n");
  } else {
    console.log(
      `  Budget: $${DAILY_BUDGET_USD.toFixed(2)}/day, $${(MAX_USD_PER_SEARCH + MAX_USD_PER_QUERY).toFixed(2)} max per question\n`,
    );
  }
});
