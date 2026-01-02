const rateLimit = require('express-rate-limit');

// Auth login limiter: 5 attempts per 15 minutes
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
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
    contactEmailLimiter
};
