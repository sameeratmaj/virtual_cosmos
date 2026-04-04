import mongoose from "mongoose";

export async function connectDatabase(mongoUri) {
  try {
    await mongoose.connect(mongoUri);
    console.log("MongoDB connected");
    return true;
  } catch (error) {
    console.warn("MongoDB connection failed. Continuing without persistence:", error.message);
    return false;
  }
}
