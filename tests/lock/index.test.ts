import config from "config";
import { MongoDBCron } from "../../src";

describe("Create model", () => {
  let mongodbCron: any;

  beforeAll(async () => {
    mongodbCron = await MongoDBCron.create(config.get("db.url"));
  });

  afterAll(async () => {
    await mongodbCron.Lock.deleteMany({});
    await mongodbCron.connection.close().then();
  });

  it("should create and acquire a lock if it doesn't exist", async () => {
    const lockName = "testLock";
    const ttl = 1000;
    const lock = await mongodbCron.acquireLockAndCreateIfDoesNotExist({
      name: lockName,
      ttl,
    });

    expect(lock).not.toBeNull();
    expect(lock!.name).toEqual(lockName);
    expect(lock!.isAcquired).toBe(true);
  });

  it("should not acquire a lock if it's already acquired and ttl hasn't passed", async () => {
    const lockName = "testLock2";
    const ttl = 10000;
    const firstAttempt = await mongodbCron.acquireLockAndCreateIfDoesNotExist({
      name: lockName,
      ttl,
    });
    expect(firstAttempt).not.toBeNull();

    const secondAttempt = await mongodbCron.acquireLockAndCreateIfDoesNotExist({
      name: lockName,
      ttl,
    });

    expect(secondAttempt).toBeNull();
  });

  it("should acquire a lock if it's already acquired but ttl has passed", async () => {
    const lockName = "testLock3";
    const ttl = 1000;
    await mongodbCron.acquireLockAndCreateIfDoesNotExist({
      name: lockName,
      ttl,
    });

    // Simulate waiting for TTL to pass
    await new Promise((resolve) => setTimeout(resolve, ttl + 100));

    const lockAfterTTL = await mongodbCron.acquireLockAndCreateIfDoesNotExist({
      name: lockName,
      ttl,
    });
    expect(lockAfterTTL).not.toBeNull();
    expect(lockAfterTTL!.isAcquired).toBe(true);
  });

  it("should increment the fencingToken when acquiring a lock", async () => {
    const lockName = "testLock4";
    const ttl = 1000;
    const firstLock = await mongodbCron.acquireLockAndCreateIfDoesNotExist({
      name: lockName,
      ttl,
    });
    expect(firstLock!.fencingToken).toBe(0);

    // Simulate waiting for TTL to pass
    await mongodbCron.releaseLock({ name: lockName, fencingToken: 0 });

    const secondLock = await mongodbCron.acquireLockAndCreateIfDoesNotExist({
      name: lockName,
      ttl,
    });
    expect(secondLock?.fencingToken).toBe(1);
  });
  it("should allow immediate re-acquisition after release", async () => {
    const lockName = "reacquisitionTest";
    const ttl = 500;
    const firstLock = await mongodbCron.acquireLockAndCreateIfDoesNotExist({
      name: lockName,
      ttl,
    });
    await mongodbCron.releaseLock({
      name: lockName,
      fencingToken: firstLock!.fencingToken,
    });
    const secondLock = await mongodbCron.acquireLockAndCreateIfDoesNotExist({
      name: lockName,
      ttl,
    });
    expect(secondLock).not.toBeNull();
  });
  it("should allow only one client to acquire the lock in high contention", async () => {
    const lockName = "highContentionTest";
    const ttl = 1000;

    // Simulating 10 clients trying to acquire the lock concurrently
    const promises = Array(10)
      .fill(null)
      .map(async () => {
        return mongodbCron.acquireLockAndCreateIfDoesNotExist({
          name: lockName,
          ttl,
        });
      });

    const results = await Promise.all(promises);

    // Assuming `acquireLock` returns null if the lock acquisition fails
    const successfulAcquires = results.filter((lock) => lock !== null);

    // Only one client should have been successful in acquiring the lock
    expect(successfulAcquires.length).toBe(1);
  });
});
