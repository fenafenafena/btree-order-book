/**
 * Simple throughput micro-benchmark.
 * Run: npm run bench
 */
import { OrderBook, Side } from './index';

function run(): void {
  const book = new OrderBook();
  const n = 50_000;

  // Seed a two-sided book
  for (let i = 0; i < 1_000; i++) {
    book.limit({ id: `bid-${i}`, side: Side.BUY, size: 10, price: 100 - (i % 50) });
    book.limit({ id: `ask-${i}`, side: Side.SELL, size: 10, price: 101 + (i % 50) });
  }

  const start = process.hrtime.bigint();
  let fills = 0;

  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? Side.BUY : Side.SELL;
    const price = side === Side.BUY ? 101 + (i % 10) : 100 - (i % 10);
    const result = book.limit({
      id: `t-${i}`,
      side,
      size: 1,
      price,
    });
    fills += result.trades.length;

    // Keep book from growing unbounded: cancel if rested
    if (result.quantityFilled === 0 || (result.partial && result.partial.size > 0)) {
      try {
        book.cancel(`t-${i}`);
      } catch {
        /* already gone */
      }
    }
  }

  const elapsedNs = Number(process.hrtime.bigint() - start);
  const elapsedMs = elapsedNs / 1e6;
  const opsPerSec = (n / elapsedMs) * 1000;

  console.log(`Orders:     ${n}`);
  console.log(`Trades:     ${fills}`);
  console.log(`Elapsed:    ${elapsedMs.toFixed(2)} ms`);
  console.log(`Throughput: ${opsPerSec.toFixed(0)} orders/sec`);
}

run();
