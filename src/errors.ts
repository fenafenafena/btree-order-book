export class OrderBookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderBookError';
  }
}

export class DuplicateOrderError extends OrderBookError {
  constructor(orderId: string) {
    super(`Order already exists: ${orderId}`);
    this.name = 'DuplicateOrderError';
  }
}

export class OrderNotFoundError extends OrderBookError {
  constructor(orderId: string) {
    super(`Order not found: ${orderId}`);
    this.name = 'OrderNotFoundError';
  }
}

export class InvalidOrderError extends OrderBookError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOrderError';
  }
}
