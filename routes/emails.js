const express = require('express');
const { body, validationResult } = require('express-validator');
const Email = require('../models/Email');
const { sendContactEmail, sendContactAutoReplyToClient } = require('../config/email');
const { contactEmailLimiter } = require('../middleware/rateLimiters');
const logger = require('../utils/logger');

const router = express.Router();

const contactValidation = [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('phone').optional().trim().isLength({ min: 8, max: 20 }),
    body('subject').trim().isLength({ min: 3, max: 200 }).withMessage('Subject must be between 3 and 200 characters'),
    body('message').trim().isLength({ min: 10, max: 2000 }).withMessage('Message must be between 10 and 2000 characters'),
];

router.post('/', contactEmailLimiter, contactValidation, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: 'ValidationError',
                errors: errors.array()
            });
        }

        const { name, email, phone, subject, message, type } = req.body;

        const created = await Email.create({
            senderName: name,
            senderEmail: email,
            senderPhone: phone,
            subject,
            message,
            type: type || 'contact',
            status: 'new'
        });

        // ✅ Return success IMMEDIATELY - email is saved to database!
        // This is critical for UX: user gets instant feedback
        res.status(201).json({
            success: true,
            emailId: created._id,
        });

        // 🔄 Send auto-reply to client in background (non-blocking)
        // Must not affect admin email behavior or API response
        setImmediate(async () => {
            try {
                const result = await sendContactAutoReplyToClient({
                    to: email,
                    name
                });

                if (result && result.success) {
                    logger.info('Auto-reply email sent to client for contact form', {
                        emailId: created._id,
                        to: email
                    });
                } else {
                    logger.warn('Failed to send auto-reply email to client for contact form', {
                        emailId: created._id,
                        to: email,
                        error: result && result.error
                    });
                }
            } catch (err) {
                logger.error('Failed to send auto-reply email to client for contact form:', err);
            }
        });

        // 🔄 Send email notification in background (non-blocking)
        // Uses setImmediate to ensure this runs after response is sent
        setImmediate(async () => {
            try {
                const emailResult = await sendContactEmail({ name, email, phone, subject, message });
                if (emailResult && emailResult.success) {
                    logger.info('Notification email sent for contact form', { emailId: created._id });
                } else {
                    logger.warn('Failed to send contact notification email', { emailId: created._id });
                }
            } catch (err) {
                logger.error('Failed to send contact notification email:', err);
                // Email failure is logged but doesn't affect user's submission
            }
        });
    } catch (error) {
        logger.error('Error submitting contact email:', error);
        const message = process.env.NODE_ENV === 'development'
            ? (error && error.message) || 'Failed to submit message'
            : 'Failed to submit message';
        return res.status(500).json({
            success: false,
            error: 'ServerError',
            message
        });
    }
});

module.exports = router;
