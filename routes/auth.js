const express = require('express');
const jwt = require('jsonwebtoken');
const { check, validationResult } = require('express-validator');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiters');
const logger = require('../utils/logger');

const router = express.Router();

const isProd = process.env.NODE_ENV === 'production';

const cookieOptions = {
    httpOnly: true,
    secure: isProd,                    // HTTPS only in production
    sameSite: isProd ? 'none' : 'lax', // CRITICAL FIX
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000    // 7 days
};

// @route   POST api/auth/login
// @desc    Authenticate admin & get token
// @access  Public
router.post(
    '/login',
    loginLimiter, // Apply rate limiter
    [
        check('email', 'Email is required').isEmail(),
        check('password', 'Password is required').exists()
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: 'ValidationError',
                errors: errors.array()
            });
        }

        const { email, password } = req.body;
        const normalizedEmail = (email || '').toLowerCase().trim();

        try {
            const user = await User.findOne({ email: normalizedEmail }).select('+password +active');

            if (!user) {
                return res.status(400).json({
                    success: false,
                    error: 'AuthError',
                    message: 'Invalid credentials'
                });
            }

            const ok = await user.correctPassword(password, user.password);

            if (!ok) {
                return res.status(400).json({
                    success: false,
                    error: 'AuthError',
                    message: 'Invalid credentials'
                });
            }

            if (user.role !== 'admin') {
                return res
                    .status(403)
                    .json({
                        success: false,
                        error: 'Forbidden',
                        message: 'You do not have permission to perform this action'
                    });
            }

            const payload = { id: user._id.toString() };

            jwt.sign(
                payload,
                process.env.JWT_SECRET,
                { expiresIn: '7d' }, // Increased to match cookie maxAge
                (err, token) => {
                    if (err) {
                        throw err;
                    }

                    // Set cookie with proper configuration for cross-domain (Vercel ↔ Railway)
                    res.cookie('token', token, cookieOptions);

                    res.json({
                        success: true,
                        admin: { email: user.email, role: user.role }
                    });
                }
            );
        } catch (err) {
            logger.error(err.message);
            res.status(500).json({
                success: false,
                error: 'ServerError',
                message: 'Server error'
            });
        }
    }
);

router.post('/logout', auth, (req, res) => {
    res.clearCookie('token', cookieOptions);
    res.status(200).json({
        success: true,
        message: 'Logged out successfully'
    });
});

// @route   GET api/auth/verify
// @desc    Verify token and return user data
// @access  Private
router.get('/verify', (req, res) => {
    try {
        // Get token EXCLUSIVELY from cookie (no Authorization header as per requirements)
        const token = (req.cookies?.token || '').trim();

        if (!token) {
            return res.status(401).json({ success: false, error: 'AuthError', message: 'No token, authorization denied' });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Legacy env-admin token support
        if (decoded && decoded.user && decoded.user.id === 'admin') {
            return res.json({
                success: true,
                admin: {
                    username: decoded.user.username,
                    role: decoded.user.role
                }
            });
        }

        return User.findById(decoded.id)
            .then((user) => {
                if (!user) {
                    return res.status(401).json({ success: false, error: 'AuthError', message: 'Token is not valid' });
                }

                return res.json({
                    success: true,
                    admin: {
                        email: user.email,
                        role: user.role
                    }
                });
            })
            .catch((err) => {
                return res.status(401).json({ success: false, error: 'AuthError', message: 'Token is not valid' });
            });
    } catch (err) {
        res.status(401).json({ success: false, error: 'AuthError', message: 'Token is not valid' });
    }
});

module.exports = router;
