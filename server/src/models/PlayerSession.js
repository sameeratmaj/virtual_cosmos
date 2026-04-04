import mongoose from "mongoose";

const playerSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    x: {
      type: Number,
      default: 320,
    },
    y: {
      type: Number,
      default: 240,
    },
    socketId: {
      type: String,
      default: null,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: false,
      index: true,
    },
    lastSeenAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export const PlayerSession = mongoose.model("PlayerSession", playerSessionSchema);
