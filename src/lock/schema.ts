import mongoose from "mongoose";

export interface ILockSchema {
  name: string;
  isAcquired: boolean;
  lastAcquiredTime: Date;
  ttl: number;
  fencingToken: number;
}

export const lockSchema = new mongoose.Schema<ILockSchema>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    isAcquired: {
      type: Boolean,
      required: true,
    },
    lastAcquiredTime: {
      type: Date || null,
    },
    ttl: {
      type: Number || null,
    },
    fencingToken: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);
