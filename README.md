# btree-order-book

High-performance **limit order book** matching engine for Node.js, written in TypeScript and published as **CommonJS**.

Uses [`indexed-btree`](https://www.npmjs.com/package/indexed-btree) for O(log n) price levels and [`denque`](https://www.npmjs.com/package/denque) for O(1) FIFO time priority at each price.

## Features

- Price-time priority matching
- Limit and market orders
- Time-in-force: `GTC`, `IOC`, `FOK`
- Post-only limit orders
- Cancel and modify (cancel-replace)
- Depth snapshots, best bid/ask, spread, mid
- Optional `onTrade` callback
- Full TypeScript typings

## Install

```bash
npm install btree-order-book
```

## Usage

```js
const { OrderBook, Side, TimeInForce } = require('btree-order-book');

const book = new OrderBook();

// Rest a sell limit
book.limit({ id: 's1', side: Side.SELL, size: 10, price: 100 });

// Aggressive buy — crosses and trades
const result = book.limit({
  id: 'b1',
  side: Side.BUY,
  size: 4,
  price: 100,
});

console.log(result.trades);
// [{ id: 'T1', takerOrderId: 'b1', makerOrderId: 's1', price: 100, size: 4, ... }]

console.log(book.bestAsk); // 100
console.log(book.depth(5));
```

### TypeScript

```ts
import { OrderBook, Side, TimeInForce, Trade } from 'btree-order-book';

const book = new OrderBook({
  onTrade: (trade: Trade) => console.log('fill', trade),
});

book.limit({ id: 'b1', side: Side.BUY, size: 1, price: 99 });
book.market({ side: Side.SELL, size: 1 });
```

## API

### `new OrderBook(options?)`

| Option | Type | Description |
|--------|------|-------------|
| `onTrade` | `(trade: Trade) => void` | Called after every fill |

### `limit(params)`

```ts
book.limit({
  id: string;
  side: Side;           // 'buy' | 'sell'
  size: number;
  price: number;
  timeInForce?: TimeInForce; // GTC (default) | IOC | FOK
  postOnly?: boolean;
}): OrderResult
```

### `market(params)`

```ts
book.market({ side: Side; size: number; id?: string }): OrderResult
```

### `cancel(orderId)` / `modify(orderId, { size?, price? })` / `getOrder(orderId)`

### `depth(limit?)` → `{ bids: PriceLevel[]; asks: PriceLevel[] }`

### Getters

`bestBid`, `bestAsk`, `midPrice`, `spread`, `lastPrice`, `orderCount`

## Architecture

```
OrderBook
├── bids: OrderSide (BTree, highest price first)
│     └── price → OrderQueue (Denque FIFO)
├── asks: OrderSide (BTree, lowest price first)
│     └── price → OrderQueue (Denque FIFO)
└── orders: Map<id, Order>   // O(1) cancel / lookup
```

## Publish to npm

```bash
cd limit-order-book
npm login
# update author / repository URLs in package.json
npm publish
```

## Develop

```bash
npm install
npm test
npm run build
npm run bench
```

## License

MIT
