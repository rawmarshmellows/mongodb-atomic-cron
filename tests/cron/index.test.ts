/* eslint-disable */
import config from "config";
import { MongoDBCron } from "../../src";

describe("Test Cron Job", () => {
  let mongodbCron: any;

  beforeAll(async () => {
    mongodbCron = await MongoDBCron.create(config.get("db.url"));
  });

  afterAll(async () => {
    await mongodbCron.Lock.deleteMany({});
    await mongodbCron.connection.close().then();
  });

  it("should increment a counter every second", async () => {
    let counter = 0;
    const handler = () => {
      counter += 1;
    };

    // Schedule the cron job to increment the counter every second
    const job = mongodbCron.scheduleCronJob("* * * * * *", handler);

    // Set a timeout to stop the cron job after 5 seconds
    await new Promise((resolve) => setTimeout(resolve, 5000));

    job.stop(); // Stop the cron job
    expect(counter).toBe(4); // Expect the counter to have been incremented
  }, 10000);

  it("should increment a counter every second when there is one client", async () => {
    const lockName = "singleClientCronJob";
    const lockTtl = 1000;

    let fencingToken = undefined;
    let counter = 0;
    const handler = async ({ lock }: { lock: any }) => {
      counter += 1;
      fencingToken = lock.fencingToken;
    };

    const runOnceEverySecond = "* * * * * *";
    const task = mongodbCron.scheduleCronJobWithLock(
      { schedule: runOnceEverySecond, scheduled: true },
      {
        lockName,
        lockTtl,
      },
      handler,
    );

    await new Promise((resolve) => setTimeout(resolve, 5500));

    task.stop();

    // t=0: job is scheduled
    // 0<t<1: timer is started
    // t=1: job is run
    // t=2: job is run
    // t=3: job is run
    // t=4: job is run
    // t=5: job is run
    // 5<t<6: timer is stop & job is stopped

    expect(fencingToken).toBe(4);
    expect(counter).toBe(5);
  }, 10000);

  it("should increment the counter twice, even if it get's stuck in the handler", async () => {
    const lockName = "singleClientCronJobWithTimeout";
    const lockTtl = 1000;

    let fencingToken = undefined;
    let counter = 0;

    const runOnceEveryFiveSeconds = "*/2 * * * * *";
    const task = mongodbCron.scheduleCronJobWithLock(
      { schedule: runOnceEveryFiveSeconds, scheduled: true },
      {
        lockName,
        lockTtl,
      },
      async ({ lock }: { lock: any }) => {
        counter += 1;
        fencingToken = lock.fencingToken;

        if (lock.fencingToken === 0) {
          console.log("Stuck in handler");
          await new Promise((resolve) => setTimeout(resolve, 3000));
          console.log("Unstuck!");
        }
      },
    );

    /*
    The first call will be 2 seconds after the cron job is scheduled
    On the 3rd second, the lock will expire and thus can be acquired again
    The second call will be 4 seconds after the cron job is scheduled
    Since there is a timeout for 5 seconds, the cron job will be stopped before the third call
    */
    await new Promise((resolve) => setTimeout(resolve, 5000));

    task.stop();

    expect(fencingToken).toBe(1);
    expect(counter).toBe(2);
  }, 7500);

  it("should increment a counter every second even if there are multiple clients", async () => {
    const lockName = "multipleClientCronJob";
    const lockTtl = 1500;

    let fencingToken = undefined;
    let counter = 0;

    const cronJobs = [];

    const runOnceEveryTwoSeconds = "*/2 * * * * *";
    const jobScheduledTime = new Date();
    for (let i = 0; i < 2; i++) {
      console.log("jobScheduledTime", jobScheduledTime);
      const cronJob = mongodbCron.scheduleCronJobWithLock(
        { schedule: runOnceEveryTwoSeconds, scheduled: true },
        {
          lockName,
          lockTtl,
        },
        async ({ lock }: { lock: any }) => {
          counter += 1;
          fencingToken = lock.fencingToken;
          if (lock.fencingToken === 0) {
            await new Promise((resolve) => setTimeout(resolve, 2500));
          }
        },
      );

      cronJobs.push(cronJob);
    }

    /*
    t=0: jobs are scheduled
    0<t<1: timer is started
    t=2: jobs are acquired, and counter is incremented, but the first one will lock until t=4.5
    t=3.5: lock expires, but first job is still running
    t=4: jobs are acquired, although lock isn't released yet, the lock will be acquired, and counter is incremented
    t=4.5: first job is finished, but lock will not be released
    5<t<6: timer is stopped
    */
    await new Promise((resolve) => setTimeout(resolve, 5000));

    cronJobs.forEach((cronJob) => cronJob.stop());

    expect(fencingToken).toBe(1);
    expect(counter).toBe(2);
  }, 10000);
});
