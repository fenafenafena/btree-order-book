import {
  Side,
  TimeInForce,
  CreateLimitOrderParams,
  CreateMarketOrderParams,
  ModifyOrderParams,
  OrderResult,
  Trade,
  OrderSnapshot,
  PriceLevel,
} from './types';
import { Order, nextTradeId } from './order';
import { OrderSide } from './order-side';
import {
  DuplicateOrderError,
  InvalidOrderError,
  OrderNotFoundError,
} from './errors';

export interface OrderBookOptions {
  /** Called after each successful trade (optional hook for feeds / journaling). */
  onTrade?: (trade: Trade) => void;
}

/**
 * In-memory limit order book with price-time priority matching.
 *
 * Data structures:
 * - `indexed-btree` — O(log n) price-level insert / best-price lookup
 * - `denque` — O(1) FIFO at each price for time priority
 * - `Map` — O(1) order lookup by id
 */
export class OrderBook {
  private readonly bids: OrderSide;
  private readonly asks: OrderSide;
  private readonly orders: Map<string, Order>;
  private readonly onTrade?: (trade: Trade) => void;
  private lastTradePrice: number | null = null;

  constructor(options: OrderBookOptions = {}) {
    this.bids = new OrderSide(Side.BUY);
    this.asks = new OrderSide(Side.SELL);
    this.orders = new Map();
    this.onTrade = options.onTrade;
  }

  /** Best bid price, or undefined if empty. */
  get bestBid(): number | undefined {
    return this.bids.bestPrice;
  }

  /** Best ask price, or undefined if empty. */
  get bestAsk(): number | undefined {
    return this.asks.bestPrice;
  }

  /** Mid price, or null if either side is empty. */
  get midPrice(): number | null {
    const bid = this.bestBid;
    const ask = this.bestAsk;
    if (bid === undefined || ask === undefined) return null;
    return (bid + ask) / 2;
  }

  /** Spread (ask − bid), or null if either side is empty. */
  get spread(): number | null {
    const bid = this.bestBid;
    const ask = this.bestAsk;
    if (bid === undefined || ask === undefined) return null;
    return ask - bid;
  }

  get lastPrice(): number | null {
    return this.lastTradePrice;
  }

  get orderCount(): number {
    return this.orders.size;
  }

  /**
   * Place a limit order. Crosses the spread immediately when price-aggressive,
   * then rests any remainder (unless IOC / FOK / postOnly).
   */
  limit(params: CreateLimitOrderParams): OrderResult {
    const {
      id,
      side,
      size,
      price,
      timeInForce = TimeInForce.GTC,
      postOnly = false,
    } = params;

    this.validateId(id);
    this.validateSize(size);
    this.validatePrice(price);

    if (this.orders.has(id)) {
      throw new DuplicateOrderError(id);
    }

    if (postOnly && this.wouldCross(side, price)) {
      throw new InvalidOrderError(
        `Post-only order ${id} would take liquidity at price ${price}`,
      );
    }

    if (timeInForce === TimeInForce.FOK && !this.canFullyFill(side, size, price)) {
      return this.emptyResult(size);
    }

    const taker = new Order(id, side, size, price, timeInForce);
    const result = this.match(taker, price);

    if (taker.size > 0 && timeInForce === TimeInForce.GTC) {
      this.rest(taker);
      result.partial = taker.toSnapshot();
    } else if (taker.size > 0 && timeInForce === TimeInForce.IOC) {
      result.partial = taker.toSnapshot();
    } else if (taker.isFilled()) {
      result.done.push(taker.toSnapshot());
    }

    result.quantityLeft =
      timeInForce === TimeInForce.GTC
        ? 0
        : Math.max(0, size - result.quantityFilled);

    return result;
  }

  /**
   * Place a market order — takes available liquidity at any price until
   * filled or liquidity is exhausted.
   */
  market(params: CreateMarketOrderParams): OrderResult {
    const {
      side,
      size,
      id = `MKT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    } = params;

    this.validateSize(size);

    const aggressivePrice =
      side === Side.BUY ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    const taker = new Order(id, side, size, 0, TimeInForce.IOC);
    // price on Order is unused for matching when we pass aggressivePrice
    const result = this.match(taker, aggressivePrice);

    result.quantityLeft = Math.max(0, size - result.quantityFilled);
    if (taker.isFilled()) {
      result.done.push(taker.toSnapshot());
    } else if (result.quantityFilled > 0) {
      result.partial = taker.toSnapshot();
    }

    return result;
  }

  /** Cancel a resting order by id. Returns the cancelled order snapshot. */
  cancel(orderId: string): OrderSnapshot {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }
    this.removeFromBook(order);
    return order.toSnapshot();
  }

  /**
   * Modify price and/or size of a resting order.
   * Cancel-replace: loses time priority when re-inserted.
   */
  modify(orderId: string, params: ModifyOrderParams): OrderResult {
    const existing = this.orders.get(orderId);
    if (!existing) {
      throw new OrderNotFoundError(orderId);
    }

    const newSize = params.size ?? existing.size;
    const newPrice = params.price ?? existing.price;

    this.validateSize(newSize);
    this.validatePrice(newPrice);

    const side = existing.side;
    const tif = existing.timeInForce;

    this.removeFromBook(existing);

    return this.limit({
      id: orderId,
      side,
      size: newSize,
      price: newPrice,
      timeInForce: tif,
    });
  }

  /** Lookup a resting order. */
  getOrder(orderId: string): OrderSnapshot | undefined {
    return this.orders.get(orderId)?.toSnapshot();
  }

  /** Aggregated depth for both sides (best prices first). */
  depth(limit?: number): { bids: PriceLevel[]; asks: PriceLevel[] } {
    return {
      bids: this.bids.toDepth(limit),
      asks: this.asks.toDepth(limit),
    };
  }

  /** Remove all orders. */
  clear(): void {
    this.orders.clear();
    this.bids.clear();
    this.asks.clear();
    this.lastTradePrice = null;
  }

  // --- internals -----------------------------------------------------------

  private sideBook(side: Side): OrderSide {
    return side === Side.BUY ? this.bids : this.asks;
  }

  private oppositeBook(side: Side): OrderSide {
    return side === Side.BUY ? this.asks : this.bids;
  }

  private wouldCross(side: Side, price: number): boolean {
    if (side === Side.BUY) {
      const bestAsk = this.asks.bestPrice;
      return bestAsk !== undefined && price >= bestAsk;
    }
    const bestBid = this.bids.bestPrice;
    return bestBid !== undefined && price <= bestBid;
  }

  private canFullyFill(side: Side, size: number, limitPrice: number): boolean {
    let remaining = size;
    const book = this.oppositeBook(side);

    book.forEachLevel((queue, price) => {
      if (!this.priceMatches(side, limitPrice, price)) {
        return false; // stop — worse prices won't help
      }
      remaining -= queue.volume;
      return remaining > 0; // continue while still needing size
    });

    return remaining <= 0;
  }

  private priceMatches(
    takerSide: Side,
    takerPrice: number,
    makerPrice: number,
  ): boolean {
    if (takerSide === Side.BUY) {
      return takerPrice >= makerPrice;
    }
    return takerPrice <= makerPrice;
  }

  private match(taker: Order, limitPrice: number): OrderResult {
    const done: OrderSnapshot[] = [];
    const trades: Trade[] = [];
    let quantityFilled = 0;
    const book = this.oppositeBook(taker.side);

    while (taker.size > 0) {
      const queue = book.getBestQueue();
      if (!queue) break;
      if (!this.priceMatches(taker.side, limitPrice, queue.price)) break;

      const maker = queue.front();
      if (!maker) {
        book.removeFront(queue);
        continue;
      }

      const fillSize = Math.min(taker.size, maker.size);
      const fillPrice = maker.price;

      taker.reduceSize(fillSize);
      maker.reduceSize(fillSize);
      queue.updateVolume(-fillSize);
      quantityFilled += fillSize;

      const trade: Trade = {
        id: nextTradeId(),
        takerOrderId: taker.id,
        makerOrderId: maker.id,
        price: fillPrice,
        size: fillSize,
        side: taker.side,
        timestamp: Date.now(),
      };
      trades.push(trade);
      this.lastTradePrice = fillPrice;
      this.onTrade?.(trade);

      if (maker.isFilled()) {
        done.push(maker.toSnapshot());
        this.orders.delete(maker.id);
        book.removeFront(queue);
      }
    }

    return {
      done,
      partial: null,
      quantityFilled,
      quantityLeft: 0,
      trades,
    };
  }

  private rest(order: Order): void {
    this.sideBook(order.side).append(order);
    this.orders.set(order.id, order);
  }

  private removeFromBook(order: Order): void {
    this.sideBook(order.side).remove(order);
    this.orders.delete(order.id);
  }

  private emptyResult(size: number): OrderResult {
    return {
      done: [],
      partial: null,
      quantityFilled: 0,
      quantityLeft: size,
      trades: [],
    };
  }

  private validateId(id: string): void {
    if (!id || typeof id !== 'string') {
      throw new InvalidOrderError('Order id must be a non-empty string');
    }
  }

  private validateSize(size: number): void {
    if (typeof size !== 'number' || !(size > 0) || !Number.isFinite(size)) {
      throw new InvalidOrderError(`Invalid size: ${size}`);
    }
  }

  private validatePrice(price: number): void {
    if (typeof price !== 'number' || !(price > 0) || !Number.isFinite(price)) {
      throw new InvalidOrderError(`Invalid price: ${price}`);
    }
  }
}
