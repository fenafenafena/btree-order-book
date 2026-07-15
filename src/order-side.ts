import BTree from 'indexed-btree';
import { Side } from './types';
import { Order } from './order';
import { OrderQueue } from './order-queue';

/**
 * One side of the book: sorted price → FIFO order queue.
 *
 * Asks: ascending prices (best ask = lowest = tree min).
 * Bids: descending prices (best bid = highest = tree min via reverse compare).
 */
export class OrderSide {
  readonly side: Side;
  /** Price → queue, ordered so `.minKey()` is always the best price. */
  private readonly prices: BTree<number, OrderQueue>;

  constructor(side: Side) {
    this.side = side;
    // Bids: reverse numeric order so best (highest) price is minKey().
    // Asks: natural ascending order so best (lowest) price is minKey().
    const compare =
      side === Side.BUY
        ? (a: number, b: number) => (a === b ? 0 : a > b ? -1 : 1)
        : (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);
    this.prices = new BTree<number, OrderQueue>(undefined, compare);
  }

  get depth(): number {
    return this.prices.size;
  }

  get bestPrice(): number | undefined {
    return this.prices.minKey();
  }

  getBestQueue(): OrderQueue | undefined {
    const price = this.prices.minKey();
    return price === undefined ? undefined : this.prices.get(price);
  }

  getQueue(price: number): OrderQueue | undefined {
    return this.prices.get(price);
  }

  append(order: Order): void {
    let queue = this.prices.get(order.price);
    if (!queue) {
      queue = new OrderQueue(order.price);
      this.prices.set(order.price, queue);
    }
    queue.append(order);
  }

  /**
   * Remove an order from its price level. Deletes empty levels.
   */
  remove(order: Order): Order | undefined {
    const queue = this.prices.get(order.price);
    if (!queue) return undefined;
    const removed = queue.removeById(order.id);
    if (queue.isEmpty()) {
      this.prices.delete(order.price);
    }
    return removed;
  }

  /**
   * Remove the head order after a full fill. Deletes empty levels.
   */
  removeFront(queue: OrderQueue): void {
    queue.removeFront();
    if (queue.isEmpty()) {
      this.prices.delete(queue.price);
    }
  }

  /**
   * Walk price levels in best-first order.
   * Callback return value: `true` = continue, `false` = stop.
   */
  forEachLevel(fn: (queue: OrderQueue, price: number) => void | boolean): void {
    this.prices.forEach((queue: OrderQueue, price: number) => {
      const cont = fn(queue, price);
      // indexed-btree: return { break: true } to stop iteration.
      if (cont === false) return { break: true };
      return;
    });
  }

  /**
   * Depth snapshot, best price first.
   */
  toDepth(limit?: number): Array<{ price: number; size: number; orders: number }> {
    const levels: Array<{ price: number; size: number; orders: number }> = [];
    this.prices.forEach((queue: OrderQueue, price: number) => {
      levels.push({ price, size: queue.volume, orders: queue.length });
      if (limit !== undefined && levels.length >= limit) {
        return { break: true };
      }
      return;
    });
    return levels;
  }

  /** Drop every price level. */
  clear(): void {
    this.prices.clear();
  }
}
