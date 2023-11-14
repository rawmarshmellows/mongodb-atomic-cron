import { MongoError } from "mongodb";
import mongoose from "mongoose";
import cron from "node-cron";
import { lockSchema } from "./lock/schema";

export class MongoDBCron {
  connection: mongoose.Connection;
  Lock: any;

  static async create(dbUri: string) {
    const mongodbCron = new MongoDBCron(dbUri);
    return mongodbCron;
  }

  private constructor(dbUri: string) {
    this.connection = mongoose.createConnection(dbUri);
    this.Lock = this.connection.model("__mongodbcron", lockSchema);
  }

  async createLock(name: string) {
    const lock = await this.Lock.create({
      name,
      isAcquired: false,
      lastAcquiredTime: null,
      ttl: null,
    });
    return lock;
  }

  async createAndAcquireLock({ name, ttl }: { name: string; ttl: number }) {
    const lock = await this.Lock.create({
      name,
      isAcquired: true,
      lastAcquiredTime: new Date(),
      ttl,
    });
    return lock;
  }

  async checkIfLockExists(name: string) {
    const lock = await this.Lock.exists({ name }).setOptions({
      readPreference: "primary",
    });
    return lock;
  }

  async acquireLockAndCreateIfDoesNotExist({
    name,
    ttl,
  }: {
    name: string;
    ttl: number;
  }) {
    const lockExists = await this.checkIfLockExists(name);

    if (!lockExists) {
      try {
        const lock = await this.createAndAcquireLock({ name, ttl });
        return lock;
      } catch (error) {
        if (error instanceof MongoError && error.code === 11000) {
          console.warn(`Duplicate key error when creating lock ${name}`);
          return null;
        } else {
          console.error(error);
          throw error;
        }
      }
    }

    const lock = await this.acquireLock({ name, ttl });
    return lock;
  }

  async acquireLock({ name, ttl }: { name: string; ttl: number }) {
    const currentTime = new Date();

    const lock = await this.Lock.findOneAndUpdate(
      {
        name,
        $or: [
          { isAcquired: false },
          {
            $expr: {
              $lt: [{ $add: ["$lastAcquiredTime", "$ttl"] }, currentTime],
            },
          },
        ],
      },
      {
        isAcquired: true,
        lastAcquiredTime: currentTime,
        ttl,
        $inc: { fencingToken: 1 },
      },
      { new: true }
    ).setOptions({ readPreference: "primary" });
    return lock;
  }

  async releaseLock({
    name,
    fencingToken,
  }: {
    name: string;
    fencingToken: number;
  }) {
    const lock = await this.Lock.findOneAndUpdate(
      {
        name,
        isAcquired: true,
        fencingToken,
      },
      {
        isAcquired: false,
        lastAcquiredTime: null,
        ttl: null,
      },
      { new: true }
    ).setOptions({ readPreference: "primary" });

    return lock;
  }

  scheduleCronJob = (schedule: string, handler: any) => {
    if (!cron.validate(schedule)) {
      throw new Error("Invalid cron syntax");
    }

    const task = cron.schedule(schedule, handler, {
      scheduled: true,
    });

    return task;
  };

  scheduleCronJobWithLock = (
    { schedule, scheduled }: { schedule: string; scheduled: boolean },
    { lockName, lockTtl }: { lockName: string; lockTtl: number },
    handler: any
  ) => {
    if (!cron.validate(schedule)) {
      throw new Error("Invalid cron syntax");
    }

    const task = cron.schedule(
      schedule,
      async () => {
        const lock = await this.acquireLockAndCreateIfDoesNotExist({
          name: lockName,
          ttl: lockTtl,
        });
        if (lock) {
          await handler({ lock });
          await this.releaseLock({
            name: lockName,
            fencingToken: lock.fencingToken,
          });
        }
      },
      { scheduled }
    );

    return task;
  };
}
