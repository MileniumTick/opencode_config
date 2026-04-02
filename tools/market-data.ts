import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Fetch market data for US stocks including price, volume, and key metrics. Supports single tickers or comma-separated lists.",
  args: {
    tickers: tool.schema
      .string()
      .describe(
        "Stock ticker(s), comma-separated. Example: 'AAPL,NVDA,TSLA'",
      ),
    metrics: tool.schema
      .string()
      .optional()
      .default("price,volume,change,marketCap,pe")
      .describe(
        "Comma-separated metrics to fetch: price, volume, change, marketCap, pe, high52w, low52w, avgVolume. Default: price,volume,change,marketCap,pe",
      ),
  },
  async execute(args) {
    const tickerList = args.tickers
      .toUpperCase()
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
    const metrics = args.metrics.split(",").map((m) => m.trim())

    if (tickerList.length === 0) {
      return "Error: No tickers provided."
    }

    if (tickerList.length > 20) {
      return "Error: Maximum 20 tickers per request."
    }

    const results: Record<string, unknown> = {}

    for (const ticker of tickerList) {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=1d`
        const response = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0" },
        })

        if (!response.ok) {
          results[ticker] = { error: `HTTP ${response.status}`, status: "error" }
          continue
        }

        const data = await response.json()
        const result = data?.chart?.result?.[0]
        if (!result) {
          results[ticker] = { error: "No data found", status: "error" }
          continue
        }

        const meta = result.meta
        const quote: Record<string, unknown> = {
          ticker,
          status: "ok",
        }

        if (metrics.includes("price")) quote.price = meta.regularMarketPrice
        if (metrics.includes("volume")) quote.volume = meta.regularMarketVolume
        if (metrics.includes("change")) {
          quote.change = meta.regularMarketChange
          quote.changePercent = meta.regularMarketChangePercent
        }
        if (metrics.includes("marketCap")) quote.marketCap = meta.marketCap
        if (metrics.includes("pe")) quote.pe = meta.trailingPE
        if (metrics.includes("high52w")) quote.high52w = meta.fiftyTwoWeekHigh
        if (metrics.includes("low52w")) quote.low52w = meta.fiftyTwoWeekLow
        if (metrics.includes("avgVolume"))
          quote.avgVolume = meta.averageDailyVolume3Month

        results[ticker] = quote
      } catch (err) {
        results[ticker] = { error: String(err), status: "error" }
      }
    }

    return JSON.stringify(results, null, 2)
  },
})
