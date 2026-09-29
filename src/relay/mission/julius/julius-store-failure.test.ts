import { describe, expect, it } from 'vitest';

import { JULIUS_STORE_ERROR_CLASSES, isJuliusPostgresError, juliusStoreErrorClass, juliusStoreErrorIsTransient } from './julius-store-failure';

/**
 * THE CLASS COMES FROM THE DRIVER'S CODE, AND A NON-STORE ERROR IS NOT ONE.
 *
 * Each case is a real SQLSTATE or Node errno a Julius write can raise. The last
 * group is the point of the function: a domain refusal, a dispatch error, a
 * filesystem errno and a message that merely CONTAINS the driver's words are
 * not store failures, and must keep their own meaning.
 */
const coded = (code: string) => Object.assign(new Error(`driver said ${code}`), { code });

describe('juliusStoreErrorClass names the store failure from the driver\'s code', () => {
  it.each([
    ['40001', 'serialization'], ['40P01', 'serialization'],
    ['08006', 'connection'], ['08001', 'connection'], ['08003', 'connection'],
    ['57P01', 'connection'], ['57P02', 'connection'], ['57P03', 'connection'],
    ['53300', 'resources'], ['53100', 'resources'], ['53200', 'resources'],
    ['55P03', 'lock'],
    ['23505', 'integrity'], ['23503', 'integrity'], ['22P05', 'integrity'], ['22021', 'integrity'], ['42P01', 'integrity'],
    ['XX000', 'unknown'], ['58030', 'unknown'], ['P0001', 'unknown'],
  ] as const)('SQLSTATE %s is %s', (code, expected) => {
    expect(juliusStoreErrorClass(coded(code))).toBe(expected);
  });

  it.each(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'])(
    'the socket errno %s is a lost connection', (code) => {
      expect(juliusStoreErrorClass(coded(code))).toBe('connection');
    });

  it.each(['timeout exceeded when trying to connect', 'Connection terminated unexpectedly'])(
    'pg\'s fixed driver string "%s" is a lost connection', (message) => {
      expect(juliusStoreErrorClass(new Error(message))).toBe('connection');
    });

  it('is not a store failure: a domain refusal, a dispatch error, a filesystem errno, or text that only contains the driver\'s words', () => {
    for (const notStore of [
      new Error('stale_worker_result'),
      new Error('result_after_cancellation'),
      { code: 'TIMEOUT', retryable: true },
      { code: 'WORKER_EXECUTION_FAILURE' },
      coded('EPERM'), coded('EBUSY'), coded('ENOENT'),
      new Error('upstream said: Connection terminated unexpectedly'),
      new Error('Connection terminated unexpectedly.'),
      null, undefined, 'ECONNRESET', 40001,
    ]) {
      expect(juliusStoreErrorClass(notStore), JSON.stringify(notStore) ?? String(notStore)).toBeNull();
    }
  });
});

describe('isJuliusPostgresError reads the driver\'s shape, so no provider code passes for one', () => {
  it('a SQLSTATE with the driver\'s severity is PostgreSQL; the same code without one is not assumed to be', () => {
    expect(isJuliusPostgresError(Object.assign(coded('40001'), { severity: 'ERROR' }))).toBe(true);
    expect(isJuliusPostgresError(Object.assign(coded('22P05'), { severity: 'ERROR' }))).toBe(true);
    expect(isJuliusPostgresError(coded('40001')), 'a bare code could be anyone\'s').toBe(false);
    expect(isJuliusPostgresError(Object.assign(coded('ECONNRESET'), { severity: 'ERROR' })), 'a socket errno is ambiguous').toBe(false);
    expect(isJuliusPostgresError(Object.assign(coded('429'), { severity: 'ERROR' })), 'an HTTP status is a provider\'s').toBe(false);
    expect(isJuliusPostgresError(Object.assign(coded('40001'), { severity: '' }))).toBe(false);
    expect(isJuliusPostgresError(null)).toBe(false);
  });
});

describe('only a class that can succeed on repetition is transient', () => {
  it('serialization, connection, resources and lock are; integrity, unknown and "not a store error" are not', () => {
    const transient = JULIUS_STORE_ERROR_CLASSES.filter((storeClass) => juliusStoreErrorIsTransient(storeClass));
    expect(transient).toEqual(['serialization', 'connection', 'resources', 'lock']);
    expect(juliusStoreErrorIsTransient(null), 'a non-store error is never retried as one').toBe(false);
  });

  it('the NUL refusal (22P05) is integrity: repeating the same bytes fails the same way', () => {
    expect(juliusStoreErrorIsTransient(juliusStoreErrorClass(coded('22P05')))).toBe(false);
  });
});
