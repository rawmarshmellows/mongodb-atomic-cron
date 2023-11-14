import mongoose from "mongoose";

const db = {
  async connect(dbUri: string, opts: any = {}) {
    const conn = mongoose.connection;
    const connOpts = { ...opts };

    await mongoose.connect(dbUri, connOpts);
    return conn;
  },

  async withTransaction(transactionCallBack: any, opts: any = {}) {
    let session;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(
        async (_session) => transactionCallBack(_session),
        opts
      );
      await session.endSession();
    } catch (error) {
      if (session) await session.endSession();
      // Error code 20 is MongoError IllegalOperation, which is thrown when a transaction is aborted
      if ((error as any).code === 20) {
        console.warn(
          "Not connected to a replica set member. The operations will be executed without transaction."
        );
        await transactionCallBack();
      } else {
        throw new Error(`Transaction failed: ${error}`);
      }
    }
  },

  lib: mongoose,
};

export default db;
