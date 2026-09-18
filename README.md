# One question, up to twenty X posts, in full

[![Run on Replit](https://replit.com/badge/github/taskfuel/one-search-twenty-x-posts)](https://replit.com/github.com/taskfuel/one-search-twenty-x-posts)

Open it in Replit with one click, add your own key, and ask X a question.

Ask in plain English. A model turns your question into an X search query, the
search runs, and up to twenty posts come back newest first, each with its full
text, its likes, reposts, replies and quotes, and a link to the original. A
narrow question returns fewer than twenty, which is the search doing its job.

| call | what it does | price |
|---|---|---|
| chat completion | writes the search query from your question | $0.002 |
| X search | returns up to twenty matching posts | $0.005 |

Quoted 2026-09-18, so under a cent a question. The search price is per call, not
per post, and does not change with how much text comes back. The model price
depends on the tokens it uses. Prices are set by the provider and can change, so
the app shows what each call actually cost, which is the only number that is
ever authoritative.

Long posts arrive whole. Most cheap scrapers hand you a truncated `text` field,
which is the half that drops the argument, and an agent summarizing that sounds
sure of itself and gets it wrong. Posts past the old character limit are tagged
in the results with their length.

## Run it

1. **[Open it in Replit](https://replit.com/github.com/taskfuel/one-search-twenty-x-posts).**
   That imports this repo into your own account as a runnable copy.
2. **Get a key** at [app.taskfuel.ai](https://app.taskfuel.ai/?utm_source=replit&utm_medium=referral&utm_campaign=2026-09-replit-templates&utm_content=one-search-twenty-x-posts).
   The first $5 is on the house, which is around 700 questions.
3. **Give it the key.** It needs a secret named `TASKFUEL_API_KEY`. Replit's
   Agent asks for it and stores it for you, or you can add it yourself in the
   Secrets tool.
4. **Start the app.** Replit sets the run command when it imports the repo.

That is the whole setup. No X developer account, no API keys from X, no model
provider account, no integration code to keep working.

## What you can ask

Ask in your own words. The model maps the question onto X's search syntax, and
the app shows you the query it ran:

| your question | the query it writes |
|---|---|
| What has Andrej Karpathy been posting lately? | `from:karpathy` |
| Find the last 20 Tweets that mentioned @taskfuelai. | `@taskfuelai` |
| Find people saying their agent bought something on its own. | `"my agent bought" OR "agent paid for it itself"` |
| What are people saying about $BTC right now? | `$BTC` |

Results are newest first rather than ranked by relevance, so a broad question
gets you the last twenty matching posts and not the twenty best ones. On a busy
topic that can be a few minutes of posts. Ask something narrower instead, and
expect fewer results when you do.

## Or skip the app

The page is standing in for an agent: it writes the query and runs the search
the same way yours would. Once your agent is connected to TaskFuel, ask it
directly and skip the app altogether.

```
Using TaskFuel, search X for: what has Andrej Karpathy been posting lately?
Read the full text of each post rather than the preview, tell me what people
keep bringing up, and link one post per point. Show me what the search cost.
```

Not connected yet? Ask your agent:

```
Fetch https://app.taskfuel.ai/llms.txt and set taskfuel up for me.
```

That page is written for agents and points at the three ways in, so yours picks
whichever fits how it runs.

The app builds that prompt from whatever you typed and puts a copy button next
to it, so a question you liked here can move straight into your own agent.

## How it works

Both paid calls go to the same endpoint, one to write the query and one to run
the search:

```js
await fetch("https://app.taskfuel.ai/v1/call", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.TASKFUEL_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    url: "https://x402.ottoai.services/tweet-search?query=from%3Akarpathy",
    method: "GET",
    maxAmountUsd: 0.02,
  }),
});
```

TaskFuel pays the provider's HTTP-402 charge from your prepaid balance and
passes the response straight back. The response headers tell you what it cost
(`x-taskfuel-cost`) and what is left (`x-taskfuel-balance`).

There is no polling: each response carries its result.

The query is written by `anthropic/claude-haiku-4.5`, which is cheap, fast and
answers immediately. Set `QUERY_MODEL` to any of the catalog's chat models to
swap it. Prefer one that does not reason out loud: a reasoning model spends its
output budget thinking and can return nothing at all under a low `max_tokens`.

## Spending safely

The key can spend your whole balance, and nothing is watching at call time, so
the limits live in the code:

| Setting | Default | What it does |
|---|---|---|
| `MAX_USD_PER_SEARCH` | `0.02` | Hard ceiling on the X search call. The gateway rejects anything above it. |
| `MAX_USD_PER_QUERY` | `0.01` | Hard ceiling on the model call that writes the query. |
| `DAILY_BUDGET_USD` | `1.00` | Stops answering once the day's spend hits this. |

All three are optional secrets you can change without touching the code.

The per-call ceiling is enforced by the gateway, so it always holds. The daily
budget is weaker than it looks: the counter lives in memory, so it resets
whenever the app restarts, and Replit restarts these often. It stops a runaway
loop inside one session. It is not a hard cap across a day.

If you make this public and let strangers use it, they are spending *your*
balance. Keep the budget low, or make each visitor bring their own key.

## Make it yours

- **Change what comes back.** `server.js` keeps the author, text, timestamp and
  engagement counts. The raw response has more in it, so log it once and see.
- **Change how questions are read.** `QUERY_SYSTEM` in `server.js` is the whole
  translation prompt, examples included. Without its "smallest query" rule,
  models pad a simple request with a dozen synonyms and match nothing.
- **Feed it to a model.** Even twenty full posts is a small enough payload to hand
  straight to an LLM, which is the point: ask what people keep bringing up, and
  have it cite the posts.
- **Find something else entirely.** `GET https://app.taskfuel.ai/v1/discover?q=...`
  searches every provider in the catalog. There are around 90 of them, covering
  search, market data, email, phone calls and images.

The write-up behind this template:
[Let your agent analyze X for you](https://taskfuel.ai/blog/x-search-for-ai-agents/?utm_source=replit&utm_medium=referral&utm_campaign=2026-09-replit-templates&utm_content=one-search-twenty-x-posts).

Full guide for wiring an app to the gateway:
[app.taskfuel.ai/building-apps.md](https://app.taskfuel.ai/building-apps.md)

## Running outside Replit

```bash
cp .env.example .env   # then put your real key in it
node --env-file=.env server.js
```

Needs Node 20 or newer. There are no dependencies to install.
