const env = require('./env');
const connectDB = require('./db');
const { configureCloudinary } = require('./cloudinary');

// Configure Cloudinary on load (if credentials present)
configureCloudinary();

module.exports = {
  env,
  connectDB
};
