const app = require('../src/app');
const mongoose = require('mongoose');
const { env } = require('../src/config');
const { logger } = require('../src/utils');

// MongoDB connection state
let isConnected = false;

const connectToDatabase = async () => {
  if (isConnected && mongoose.connection.readyState === 1) {
    logger.info('Using existing database connection');
    return;
  }

  try {
    const options = {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      bufferCommands: false, // Disable buffering for serverless
    };

    await mongoose.connect(env.mongodbUri, options);
    isConnected = true;
    logger.info('Database connected successfully');

    // Reset isConnected flag when connection is closed
    mongoose.connection.on('disconnected', () => {
      isConnected = false;
      logger.info('Database disconnected');
    });
  } catch (error) {
    logger.error('Database connection failed:', error.message);
    isConnected = false;
    throw error;
  }
};

// Vercel serverless function handler
module.exports = async (req, res) => {
  try {
    // Ensure database connection
    await connectToDatabase();
    
    // Handle the request with Express app
    return app(req, res);
  } catch (error) {
    logger.error('Serverless function error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Please check server logs'
    });
  }
};
