const rateLimit = require('express-rate-limit');

/**
 * Custom key generator that safely extracts IP address
 * Works correctly with trust proxy enabled (Railway infrastructure)
 */
const getClientIp = (req) => {
    // After app.set('trust proxy', 1), req.ip returns the correct forwarded IP
    return req.ip || req.connection.remoteAddress || 'unknown';
};

// Auth login limiter: 5 attempts per 15 minutes
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    keyGenerator: getClientIp, // Use custom IP extractor
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).json({
            success: false,
            error: 'TooManyRequests',
            message: 'Too many login attempts. Please try again later.'
        });
    }
});

// Application submission limiter: 10 per hour per IP
const applicationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    keyGenerator: getClientIp, // Use custom IP extractor
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).json({
            success: false,
            error: 'TooManyRequests',
            message: 'Too many applications submitted. Please try again later.'
        });
    }
});

// Email contact form limiter: 5 per hour per IP
const contactEmailLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    keyGenerator: getClientIp, // Use custom IP extractor
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).json({
            success: false,
            error: 'TooManyRequests',
            message: 'Too many messages submitted. Please try again later.'
        });
    }
});

module.exports = {
    loginLimiter,
    applicationLimiter,
    contactEmailLimiter,
    getClientIp
};
