import Denque from 'denque';
import { Order } from './order';

/**
 * FIFO queue of orders at a single price level.
 * Denque gives O(1) push / shift for price-time priority.
 */
export class OrderQueue {
  readonly price: number;
  private readonly queue: Denque<Order>;
  private totalSize: number;

  constructor(price: number) {
    this.price = price;
    this.queue = new Denque<Order>();
    this.totalSize = 0;
  }

  get length(): number {
    return this.queue.length;
  }

  get volume(): number {
    return this.totalSize;
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /** Append to the back (newest / lowest time priority). */
  append(order: Order): void {
    this.queue.push(order);
    this.totalSize += order.size;
  }

  /** Peek the front order without removing it. */
  front(): Order | undefined {
    return this.queue.peekFront() ?? undefined;
  }

  /** Remove and return the front order. */
  removeFront(): Order | undefined {
    const order = this.queue.shift();
    if (order) {
      this.totalSize -= order.size;
    }
    return order;
  }

  /**
   * Remove a specific order by id (O(n) scan).
   * Used for cancel / mid-queue updates.
   */
  removeById(orderId: string): Order | undefined {
    const n = this.queue.length;
    for (let i = 0; i < n; i++) {
      const order = this.queue.get(i);
      if (order && order.id === orderId) {
        this.queue.removeOne(i);
        this.totalSize -= order.size;
        return order;
      }
    }
    return undefined;
  }

  /** Update tracked volume after a partial fill on the head order. */
  updateVolume(delta: number): void {
    this.totalSize += delta;
  }

  /** Iterate orders front → back (time priority). */
  *orders(): IterableIterator<Order> {
    const n = this.queue.length;
    for (let i = 0; i < n; i++) {
      const order = this.queue.get(i);
      if (order) yield order;
    }
  }
}
