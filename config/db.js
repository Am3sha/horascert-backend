const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async (retries = 3) => {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;

    // Fail fast if URI is missing
    if (!uri) {
        logger.error('❌ CRITICAL: MongoDB connection string is not set in environment (MONGO_URI/MONGODB_URI)');
        logger.error('Application cannot continue without database connection.');
        process.exit(1); // Fail fast in production
    }

    let attempts = 0;
    const maxAttempts = retries || 3;

    const attemptConnection = async () => {
        attempts++;
        try {
            await mongoose.connect(uri, {
                // Increased timeouts and retries to be more resilient on Atlas
                connectTimeoutMS: 30000,
                socketTimeoutMS: 45000,
                serverSelectionTimeoutMS: 30000,
                retryWrites: true,
                maxPoolSize: 10
            });

            logger.info('✅ MongoDB connected successfully');

            // Setup connection event listeners for monitoring
            mongoose.connection.on('error', (err) => {
                logger.error('🔴 MongoDB connection error:', {
                    error: err.message || err,
                    timestamp: new Date().toISOString()
                });
            });

            mongoose.connection.on('disconnected', () => {
                logger.warn('⚠️ MongoDB disconnected. Waiting for reconnection...');
            });

            mongoose.connection.on('reconnected', () => {
                logger.info('✅ MongoDB reconnected successfully');
            });

        } catch (error) {
            logger.error(`MongoDB connection attempt ${attempts}/${maxAttempts} failed:`, {
                error: error.message || error,
                attempt: attempts
            });

            if (attempts < maxAttempts) {
                const delayMs = Math.min(1000 * Math.pow(2, attempts - 1), 10000); // Exponential backoff, max 10s
                logger.warn(`⏳ Retrying in ${delayMs}ms...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                return attemptConnection();
            } else {
                logger.error(`❌ Failed to connect to MongoDB after ${maxAttempts} attempts. Exiting.`);
                process.exit(1); // Fail fast after retries exhausted
            }
        }
    };

    return attemptConnection();
};

module.exports = connectDB;
