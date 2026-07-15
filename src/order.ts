import { Side, TimeInForce, OrderSnapshot } from './types';

let tradeSeq = 0;

/** Shared counter for generating trade ids (resettable in tests). */
export function nextTradeId(): string {
  tradeSeq += 1;
  return `T${tradeSeq}`;
}

export function resetTradeIdCounter(): void {
  tradeSeq = 0;
}

/**
 * Mutable resting order. Size is reduced as fills occur.
 * Kept lean for hot-path allocation cost.
 */
export class Order {
  readonly id: string;
  readonly side: Side;
  price: number;
  size: number;
  readonly originalSize: number;
  readonly timeInForce: TimeInForce;
  readonly timestamp: number;

  constructor(
    id: string,
    side: Side,
    size: number,
    price: number,
    timeInForce: TimeInForce = TimeInForce.GTC,
    timestamp: number = Date.now(),
  ) {
    this.id = id;
    this.side = side;
    this.size = size;
    this.originalSize = size;
    this.price = price;
    this.timeInForce = timeInForce;
    this.timestamp = timestamp;
  }

  isFilled(): boolean {
    return this.size <= 0;
  }

  reduceSize(amount: number): void {
    this.size -= amount;
  }

  toSnapshot(): OrderSnapshot {
    return {
      id: this.id,
      side: this.side,
      price: this.price,
      size: this.size,
      originalSize: this.originalSize,
      timeInForce: this.timeInForce,
      timestamp: this.timestamp,
    };
  }
}
