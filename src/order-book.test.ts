import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  OrderBook,
  Side,
  TimeInForce,
  DuplicateOrderError,
  OrderNotFoundError,
  InvalidOrderError,
} from './index';
import { resetTradeIdCounter } from './order';

describe('OrderBook', () => {
  let book: OrderBook;

  beforeEach(() => {
    book = new OrderBook();
    resetTradeIdCounter();
  });

  it('rests a non-crossing limit order', () => {
    const result = book.limit({
      id: 'b1',
      side: Side.BUY,
      size: 10,
      price: 100,
    });

    assert.equal(result.quantityFilled, 0);
    assert.equal(result.trades.length, 0);
    assert.equal(book.bestBid, 100);
    assert.equal(book.orderCount, 1);
    assert.deepEqual(book.getOrder('b1')?.size, 10);
  });

  it('matches a crossing buy against resting sell', () => {
    book.limit({ id: 's1', side: Side.SELL, size: 5, price: 100 });
    const result = book.limit({ id: 'b1', side: Side.BUY, size: 5, price: 100 });

    assert.equal(result.quantityFilled, 5);
    assert.equal(result.trades.length, 1);
    assert.equal(result.trades[0].price, 100);
    assert.equal(result.trades[0].makerOrderId, 's1');
    assert.equal(result.trades[0].takerOrderId, 'b1');
    assert.equal(book.orderCount, 0);
    assert.equal(book.lastPrice, 100);
  });

  it('partially fills and rests the remainder (GTC)', () => {
    book.limit({ id: 's1', side: Side.SELL, size: 3, price: 50 });
    const result = book.limit({ id: 'b1', side: Side.BUY, size: 10, price: 50 });

    assert.equal(result.quantityFilled, 3);
    assert.equal(result.partial?.id, 'b1');
    assert.equal(result.partial?.size, 7);
    assert.equal(book.bestBid, 50);
    assert.equal(book.getOrder('b1')?.size, 7);
  });

  it('respects price-time priority across levels', () => {
    book.limit({ id: 's1', side: Side.SELL, size: 2, price: 101 });
    book.limit({ id: 's2', side: Side.SELL, size: 2, price: 100 });
    book.limit({ id: 's3', side: Side.SELL, size: 2, price: 100 });

    const result = book.limit({ id: 'b1', side: Side.BUY, size: 5, price: 101 });

    assert.equal(result.trades.length, 3);
    assert.equal(result.trades[0].makerOrderId, 's2'); // better price first
    assert.equal(result.trades[0].price, 100);
    assert.equal(result.trades[1].makerOrderId, 's3'); // time priority at 100
    assert.equal(result.trades[2].makerOrderId, 's1');
    assert.equal(result.trades[2].price, 101);
    assert.equal(result.quantityFilled, 5);
    assert.equal(book.getOrder('s1')?.size, 1);
  });

  it('fills a market buy against asks', () => {
    book.limit({ id: 's1', side: Side.SELL, size: 4, price: 10 });
    book.limit({ id: 's2', side: Side.SELL, size: 4, price: 11 });

    const result = book.market({ side: Side.BUY, size: 6 });

    assert.equal(result.quantityFilled, 6);
    assert.equal(result.quantityLeft, 0);
    assert.equal(result.trades[0].price, 10);
    assert.equal(result.trades[1].price, 11);
    assert.equal(book.bestAsk, 11);
    assert.equal(book.getOrder('s2')?.size, 2);
  });

  it('leaves unfilled quantity on market when book is thin', () => {
    book.limit({ id: 's1', side: Side.SELL, size: 2, price: 10 });
    const result = book.market({ side: Side.BUY, size: 10 });

    assert.equal(result.quantityFilled, 2);
    assert.equal(result.quantityLeft, 8);
    assert.equal(book.orderCount, 0);
  });

  it('cancels a resting order', () => {
    book.limit({ id: 'b1', side: Side.BUY, size: 1, price: 99 });
    const cancelled = book.cancel('b1');

    assert.equal(cancelled.id, 'b1');
    assert.equal(book.orderCount, 0);
    assert.equal(book.bestBid, undefined);
    assert.throws(() => book.cancel('b1'), OrderNotFoundError);
  });

  it('modifies price of a resting order', () => {
    book.limit({ id: 'b1', side: Side.BUY, size: 5, price: 90 });
    book.modify('b1', { price: 95 });

    assert.equal(book.bestBid, 95);
    assert.equal(book.getOrder('b1')?.price, 95);
  });

  it('IOC cancels unfilled remainder', () => {
    book.limit({ id: 's1', side: Side.SELL, size: 2, price: 100 });
    const result = book.limit({
      id: 'b1',
      side: Side.BUY,
      size: 5,
      price: 100,
      timeInForce: TimeInForce.IOC,
    });

    assert.equal(result.quantityFilled, 2);
    assert.equal(result.quantityLeft, 3);
    assert.equal(book.getOrder('b1'), undefined);
    assert.equal(book.orderCount, 0);
  });

  it('FOK rejects when it cannot fully fill', () => {
    book.limit({ id: 's1', side: Side.SELL, size: 2, price: 100 });
    const result = book.limit({
      id: 'b1',
      side: Side.BUY,
      size: 5,
      price: 100,
      timeInForce: TimeInForce.FOK,
    });

    assert.equal(result.quantityFilled, 0);
    assert.equal(result.quantityLeft, 5);
    assert.equal(book.getOrder('s1')?.size, 2);
  });

  it('FOK fills entirely when liquidity is enough', () => {
    book.limit({ id: 's1', side: Side.SELL, size: 5, price: 100 });
    const result = book.limit({
      id: 'b1',
      side: Side.BUY,
      size: 5,
      price: 100,
      timeInForce: TimeInForce.FOK,
    });

    assert.equal(result.quantityFilled, 5);
    assert.equal(result.quantityLeft, 0);
    assert.equal(book.orderCount, 0);
  });

  it('rejects post-only that would take', () => {
    book.limit({ id: 's1', side: Side.SELL, size: 1, price: 100 });
    assert.throws(
      () =>
        book.limit({
          id: 'b1',
          side: Side.BUY,
          size: 1,
          price: 100,
          postOnly: true,
        }),
      InvalidOrderError,
    );
  });

  it('rejects duplicate order ids', () => {
    book.limit({ id: 'b1', side: Side.BUY, size: 1, price: 100 });
    assert.throws(
      () => book.limit({ id: 'b1', side: Side.BUY, size: 1, price: 99 }),
      DuplicateOrderError,
    );
  });

  it('returns depth best-first for both sides', () => {
    book.limit({ id: 'b1', side: Side.BUY, size: 1, price: 98 });
    book.limit({ id: 'b2', side: Side.BUY, size: 2, price: 99 });
    book.limit({ id: 's1', side: Side.SELL, size: 3, price: 101 });
    book.limit({ id: 's2', side: Side.SELL, size: 4, price: 102 });

    const depth = book.depth();
    assert.deepEqual(depth.bids.map((l) => l.price), [99, 98]);
    assert.deepEqual(depth.asks.map((l) => l.price), [101, 102]);
    assert.equal(book.spread, 2);
    assert.equal(book.midPrice, 100);
  });

  it('fires onTrade callback', () => {
    const trades: string[] = [];
    book = new OrderBook({
      onTrade: (t) => trades.push(`${t.makerOrderId}:${t.size}`),
    });
    book.limit({ id: 's1', side: Side.SELL, size: 3, price: 10 });
    book.market({ side: Side.BUY, size: 3 });
    assert.deepEqual(trades, ['s1:3']);
  });
});
