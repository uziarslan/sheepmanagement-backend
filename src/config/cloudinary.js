const { v2: cloudinary } = require('cloudinary');
const env = require('./env');

const configureCloudinary = () => {
  if (env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret) {
    cloudinary.config({
      cloud_name: env.cloudinary.cloudName,
      api_key: env.cloudinary.apiKey,
      api_secret: env.cloudinary.apiSecret
    });
    return true;
  }
  return false;
};

module.exports = {
  cloudinary,
  configureCloudinary
};
