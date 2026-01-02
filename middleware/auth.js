const jwt = require('jsonwebtoken');
const { ApiError } = require('./errorHandler');
const logger = require('../utils/logger');

// Load User model
const User = require('../models/User');

// Middleware to authenticate user
const auth = async (req, res, next) => {
    try {
        // Get token from header first, then cookie (consistent with verify route)
        let token;
        if (
            req.headers.authorization &&
            req.headers.authorization.startsWith('Bearer')
        ) {
            token = req.headers.authorization.split(' ')[1];
        } else if (req.cookies?.token) {
            token = req.cookies.token;
        }

        // Check if no token
        if (!token) {
            return next(new ApiError(401, 'Please log in to access this route'));
        }

        try {
            // Verify token
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Support legacy env-admin JWTs issued by server/routes/auth.js
            if (decoded && decoded.user && decoded.user.role && decoded.user.id === 'admin') {
                req.user = decoded.user;
                res.locals.user = decoded.user;
                return next();
            }

            // Check if user still exists
            const currentUser = await User.findById(decoded.id);
            if (!currentUser) {
                return next(
                    new ApiError(401, 'The user belonging to this token no longer exists')
                );
            }

            // Check if user changed password after token was issued
            if (currentUser.changedPasswordAfter(decoded.iat)) {
                return next(
                    new ApiError(401, 'User recently changed password! Please log in again')
                );
            }

            // GRANT ACCESS TO PROTECTED ROUTE
            req.user = currentUser;
            res.locals.user = currentUser;
            next();
        } catch (error) {
            if (error.name === 'JsonWebTokenError') {
                return next(new ApiError(401, 'Invalid token. Please log in again!'));
            }
            if (error.name === 'TokenExpiredError') {
                return next(
                    new ApiError(401, 'Your token has expired! Please log in again')
                );
            }
            throw error;
        }
    } catch (error) {
        logger.error(`Authentication error: ${error.message}`, {
            url: req.originalUrl,
            method: req.method,
            ip: req.ip,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
        next(error);
    }
};

// Restrict to certain roles
const restrictTo = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return next(
                new ApiError(
                    403,
                    'You do not have permission to perform this action'
                )
            );
        }
        next();
    };
};

// Only for rendered pages, no errors!
const isLoggedIn = async (req, res, next) => {
    if (req.cookies.token) {
        try {
            // 1) Verify token
            const decoded = jwt.verify(req.cookies.token, process.env.JWT_SECRET);

            // 2) Check if user still exists
            const currentUser = await User.findById(decoded.id);
            if (!currentUser) {
                return next();
            }

            // 3) Check if user changed password after the token was issued
            if (currentUser.changedPasswordAfter(decoded.iat)) {
                return next();
            }

            // THERE IS A LOGGED IN USER
            res.locals.user = currentUser;
            return next();
        } catch (err) {
            return next();
        }
    }
    next();
};

module.exports = {
    auth,
    restrictTo,
    isLoggedIn
};
