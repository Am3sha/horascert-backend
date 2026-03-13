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

// File upload limiter: 3 uploads per 10 minutes per IP (stricter for file uploads)
const uploadLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 3,
    keyGenerator: getClientIp, // Use custom IP extractor
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).json({
            success: false,
            error: 'TooManyRequests',
            message: 'Too many file uploads. Please try again later.'
        });
    }
});

// Certificate creation limiter: 5 per hour per authenticated user
const certificateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    keyGenerator: (req) => {
        // Use user ID if authenticated, otherwise IP
        return req.user?._id?.toString() || getClientIp(req);
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).json({
            success: false,
            error: 'TooManyRequests',
            message: 'Too many certificates created. Please try again later.'
        });
    }
});

module.exports = {
    loginLimiter,
    applicationLimiter,
    contactEmailLimiter,
    uploadLimiter,
    certificateLimiter,
    getClientIp
};
