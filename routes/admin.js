const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');
const { auth, restrictTo } = require('../middleware/auth');
const { getSignedFileUrl, deleteFile } = require('../services/supabaseStorage');
const { updateApplicationAdmin } = require('../controllers/applicationController');

const Request = require('../models/Request');
const Email = require('../models/Email');

// Initialize Supabase client for file recovery
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const escapeRegex = (s = '') => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const enableAdminDebugEndpoints =
    process.env.NODE_ENV !== 'production' && process.env.ENABLE_ADMIN_DEBUG_ENDPOINTS === 'true';

// APPLY AUTH MIDDLEWARE TO ALL ADMIN ROUTES
router.use(auth);
router.use(restrictTo('admin'));

// ---------- Applications (Requests) ----------
// GET /api/v1/admin/applications
router.get('/applications', async (req, res) => {
    try {
        const { status, from, to, search } = req.query;

        const filter = {};
        if (status) {
            filter.status = String(status).trim();
        }

        if (from || to) {
            filter.createdAt = {};
            if (from) filter.createdAt.$gte = new Date(from);
            if (to) filter.createdAt.$lte = new Date(to);
        }

        if (search) {
            const safe = escapeRegex(String(search).slice(0, 200));
            filter.$or = [
                { companyName: new RegExp(safe, 'i') },
                { clientName: new RegExp(safe, 'i') },
                { email: new RegExp(safe, 'i') }
            ];
        }

        const page = parseInt(req.query.page, 10) || 1;
        let limit = parseInt(req.query.limit, 10) || 25;

        // Ensure page is at least 1
        const safePage = Math.max(1, page);
        // Enforce maximum limit to prevent huge queries
        const safeLimit = Math.min(Math.max(1, limit), 100);

        const skip = (safePage - 1) * safeLimit;

        const [total, apps] = await Promise.all([
            Request.countDocuments(filter),
            Request.find(filter).sort('-createdAt').skip(skip).limit(safeLimit).lean()
        ]);

        res.json({
            success: true,
            page: safePage,
            limit: safeLimit,
            total,
            count: apps.length,
            data: apps
        });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ success: false, error: 'Failed to fetch applications' });
    }
});

// GET /api/v1/admin/applications/:id - Get single application
router.get('/applications/:id', async (req, res) => {
    try {
        const application = await Request.findById(req.params.id);

        if (!application) {
            return res.status(404).json({
                success: false,
                error: 'Application not found'
            });
        }

        res.json({
            success: true,
            data: application
        });

    } catch (error) {
        logger.error('Error fetching application:', error);
        const safeError = process.env.NODE_ENV === 'development'
            ? (error && error.message) || 'Failed to fetch application'
            : 'Failed to fetch application';
        res.status(500).json({
            success: false,
            error: safeError
        });
    }
});

// PUT /api/v1/admin/applications/:id
router.put('/applications/:id', updateApplicationAdmin);

// GET /api/v1/admin/applications/:id/files/:fileIndex - Get signed URL for file preview
router.get('/applications/:id/files/:fileIndex', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json');

        const application = await Request.findById(req.params.id);

        if (!application) {
            return res.status(404).json({
                success: false,
                error: 'Application not found'
            });
        }

        const fileIndex = parseInt(req.params.fileIndex, 10);
        const files = application.files || [];

        if (fileIndex < 0 || fileIndex >= files.length) {
            return res.status(404).json({
                success: false,
                error: 'File not found'
            });
        }

        const file = files[fileIndex];

        // Legacy fallback: if old record stored a URL, return it directly
        if (!file.storageKey || typeof file.storageKey !== 'string' || file.storageKey.trim() === '') {
            if (file.url && typeof file.url === 'string') {
                return res.status(200).json({
                    success: true,
                    data: {
                        url: file.url,
                        fileName: file.name,
                        mimeType: file.mimeType
                    }
                });
            }

            // Try to reconstruct storageKey from file name and request ID
            // This handles cases where files exist in Supabase but lack proper DB metadata
            if (file.name && /^[a-fA-F0-9]{24}$/.test(req.params.id) && supabase) {
                try {
                    const bucket = file.bucket || process.env.STORAGE_BUCKET || 'certificates';

                    // List files for this request to find a matching file
                    const { data: listedFiles, error: listError } = await supabase.storage
                        .from(bucket)
                        .list(`requests/${req.params.id}/`, { limit: 100 });

                    if (!listError && listedFiles && listedFiles.length > 0) {
                        // Try to find a file matching the name (with or without timestamp prefix)
                        const cleanFileName = file.name.replace(/^\d+_/, '');
                        const matchingFile = listedFiles.find(f => {
                            const fClean = f.name.replace(/^\d+_/, '');
                            return fClean === cleanFileName || f.name === file.name;
                        });

                        if (matchingFile) {
                            const reconstructedKey = `requests/${req.params.id}/${matchingFile.name}`;
                            logger.info('Auto-reconstructed storageKey for file access', {
                                applicationId: req.params.id,
                                fileName: file.name,
                                reconstructedKey
                            });

                            try {
                                const signedUrl = await getSignedFileUrl(bucket, reconstructedKey, 86400);
                                return res.status(200).json({
                                    success: true,
                                    data: {
                                        url: signedUrl,
                                        fileName: file.name,
                                        mimeType: file.mimeType
                                    }
                                });
                            } catch (signErr) {
                                logger.warn('Failed to generate signed URL for reconstructed key', {
                                    reconstructedKey,
                                    error: signErr.message
                                });
                            }
                        }
                    }
                } catch (reconstructErr) {
                    logger.warn('Failed to auto-reconstruct storageKey', {
                        applicationId: req.params.id,
                        fileName: file.name,
                        error: reconstructErr.message
                    });
                }
            }

            return res.status(400).json({
                success: false,
                error: 'File record missing storageKey',
                message: 'This request contains a legacy file record without storageKey or url. Please re-upload or contact support.'
            });
        }

        // Always generate a NEW signed URL on every request (private bucket)
        try {
            const bucket = file.bucket || process.env.STORAGE_BUCKET || 'certificates';
            const signedUrl = await getSignedFileUrl(bucket, file.storageKey, 86400); // 24h

            return res.status(200).json({
                success: true,
                data: {
                    url: signedUrl,
                    fileName: file.name,
                    mimeType: file.mimeType
                }
            });
        } catch (urlError) {
            logger.error('Failed to generate signed URL:', {
                bucket: urlError.bucket || file.bucket || process.env.STORAGE_BUCKET,
                storageKey: file.storageKey,
                message: urlError.message,
                code: urlError.code,
                originalError: urlError.originalError
            });

            const debug = process.env.NODE_ENV === 'development'
                ? {
                    bucket: urlError.bucket || file.bucket || process.env.STORAGE_BUCKET,
                    storageKey: file.storageKey,
                    code: urlError.code,
                    errorMessage: urlError.message
                }
                : {
                    bucket: urlError.bucket || file.bucket || process.env.STORAGE_BUCKET,
                    storageKey: file.storageKey,
                    code: urlError.code,
                    errorMessage: 'Unavailable'
                };

            return res.status(404).json({
                success: false,
                error: 'File unavailable',
                message: 'Could not generate a signed URL for this file. The object may be missing or the storage key is invalid.',
                debug
            });
        }

    } catch (error) {
        logger.error('Error generating file URL:', error);
        const safeError = process.env.NODE_ENV === 'development'
            ? (error && error.message) || 'Failed to generate file URL'
            : 'Failed to generate file URL';

        const response = {
            success: false,
            error: safeError
        };

        if (process.env.NODE_ENV === 'development') {
            response.debug = { errorMessage: (error && error.message) || safeError };
        }

        return res.status(500).json({
            ...response
        });
    }
});

// GET /api/v1/admin/debug/storage/:requestId - Debug storage paths (TEMPORARY)
router.get('/debug/storage/:requestId', async (req, res) => {
    try {
        if (!enableAdminDebugEndpoints) {
            return res.status(404).json({
                success: false,
                error: 'NotFound',
                message: 'Route not found'
            });
        }

        const application = await Request.findById(req.params.requestId);
        if (!application) {
            return res.status(404).json({
                success: false,
                error: 'Application not found'
            });
        }

        const { listFiles } = require('../services/supabaseStorage');
        const files = application.files || [];

        let actualFiles = [];
        try {
            actualFiles = await listFiles(`requests/${req.params.requestId}/`);
        } catch (err) {
            logger.error('Failed to list Supabase files:', err);
        }

        const analysis = files.map((dbFile, index) => {
            const dbStorageKey = dbFile.storageKey;
            const matchingSupabaseFile = actualFiles.find((supabaseFile) => {
                if (supabaseFile.name === dbStorageKey) return true;

                const expectedPrefix = `requests/${req.params.requestId}/`;
                if (supabaseFile.name.startsWith(expectedPrefix)) {
                    const supabaseFilename = supabaseFile.name.replace(expectedPrefix, '');
                    const dbFilename = dbFile.name;
                    const cleanSupabaseName = supabaseFilename.replace(/^\d+_/, '');
                    return cleanSupabaseName === dbFilename;
                }

                return false;
            });

            return {
                index,
                displayName: dbFile.name,
                dbStorageKey,
                matchingSupabaseFile: matchingSupabaseFile ? matchingSupabaseFile.name : null,
                mismatch: !matchingSupabaseFile,
                supabasePath: matchingSupabaseFile ? `requests/${req.params.requestId}/${matchingSupabaseFile.name}` : null
            };
        });

        return res.json({
            success: true,
            debug: {
                requestId: req.params.requestId,
                bucket: process.env.STORAGE_BUCKET || 'certificates',
                databaseFiles: files.map((f) => ({
                    name: f.name,
                    storageKey: f.storageKey,
                    bucket: f.bucket,
                    mimeType: f.mimeType
                })),
                actualSupabaseFiles: actualFiles.map((f) => f.name),
                analysis,
                summary: {
                    totalFiles: files.length,
                    supabaseFiles: actualFiles.length,
                    mismatches: analysis.filter((a) => a.mismatch).length,
                    matches: analysis.filter((a) => !a.mismatch).length
                }
            }
        });
    } catch (error) {
        logger.error('Debug storage endpoint error:', error);
        const message = process.env.NODE_ENV === 'development'
            ? error.message || 'Failed to debug storage'
            : 'Failed to debug storage';
        return res.status(500).json({
            success: false,
            error: 'ServerError',
            message
        });
    }
});

// DELETE /api/v1/admin/applications/:applicationId
router.delete('/applications/:applicationId', async (req, res) => {
    try {
        const applicationId = (req.params.applicationId || '').trim();

        let application = null;
        if (mongoose.Types.ObjectId.isValid(applicationId)) {
            application = await Request.findById(applicationId);
        }

        // Support optional future custom id field without breaking current data model
        if (!application) {
            application = await Request.findOne({ applicationId });
        }

        if (!application) {
            return res.status(404).json({ success: false, message: 'Application not found' });
        }

        const files = Array.isArray(application.files) ? application.files : [];
        const deletionResults = [];

        if (files.length > 0) {
            await Promise.all(
                files.map(async (file) => {
                    const storageKey = file && file.storageKey;
                    const bucket = (file && file.bucket) || process.env.STORAGE_BUCKET || 'certificates';

                    if (!storageKey) {
                        deletionResults.push({
                            ok: false,
                            skipped: true,
                            reason: 'Missing storageKey',
                            bucket,
                            name: file && file.name
                        });
                        return;
                    }

                    try {
                        const result = await deleteFile(storageKey, bucket);
                        deletionResults.push({
                            ...result,
                            name: file && file.name
                        });

                        if (result.ok) {
                            logger.info('Deleted Supabase file for application', {
                                applicationId: application._id.toString(),
                                bucket: result.bucket,
                                storageKey: result.storageKey
                            });
                        } else {
                            logger.warn('Failed to delete Supabase file for application', {
                                applicationId: application._id.toString(),
                                bucket: result.bucket,
                                storageKey: result.storageKey,
                                error: result.error,
                                code: result.code,
                                skipped: result.skipped
                            });
                        }
                    } catch (err) {
                        // Belt + suspenders: deleteFile already doesn't throw for normal failures
                        logger.error('Unexpected error while deleting Supabase file for application', {
                            applicationId: application._id.toString(),
                            bucket,
                            storageKey,
                            error: err.message
                        });

                        const clientError = process.env.NODE_ENV === 'development'
                            ? err.message
                            : 'Deletion failed';

                        deletionResults.push({
                            ok: false,
                            bucket,
                            storageKey,
                            error: clientError
                        });
                    }
                })
            );
        }

        await Request.deleteOne({ _id: application._id });

        return res.json({
            success: true,
            data: {
                deletedId: application._id,
                fileDeletions: {
                    attempted: files.length,
                    succeeded: deletionResults.filter((r) => r.ok).length,
                    failed: deletionResults.filter((r) => r.ok === false && !r.skipped).length,
                    skipped: deletionResults.filter((r) => r.skipped).length
                }
            }
        });
    } catch (err) {
        logger.error(err);
        const safeError = process.env.NODE_ENV === 'development'
            ? (err && err.message) || 'Failed to delete application'
            : 'Failed to delete application';
        return res.status(500).json({ success: false, error: safeError });
    }
});

// ---------- Emails ----------
// GET /api/v1/admin/emails
router.get('/emails', async (req, res) => {
    try {
        const { recipient, from, to } = req.query;
        const filter = {};
        if (recipient) {
            const safe = escapeRegex(String(recipient).slice(0, 200));
            filter.senderEmail = new RegExp(safe, 'i');
        }
        if (from || to) filter.createdAt = {};
        if (from) filter.createdAt.$gte = new Date(from);
        if (to) filter.createdAt.$lte = new Date(to);

        const page = parseInt(req.query.page, 10) || 1;
        let limit = parseInt(req.query.limit, 10) || 25;

        // Ensure page is at least 1
        const safePage = Math.max(1, page);
        // Enforce maximum limit to prevent huge queries
        const safeLimit = Math.min(Math.max(1, limit), 100);

        const skip = (safePage - 1) * safeLimit;

        const [total, emails] = await Promise.all([
            Email.countDocuments(filter),
            Email.find(filter).sort('-createdAt').skip(skip).limit(safeLimit).lean()
        ]);

        res.json({
            success: true,
            page: safePage,
            limit: safeLimit,
            total,
            count: emails.length,
            data: emails
        });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ success: false, error: 'Failed to fetch emails' });
    }
});

// GET /api/v1/admin/emails/:id - Get single email
router.get('/emails/:id', async (req, res) => {
    try {
        const email = await Email.findById(req.params.id);

        if (!email) {
            return res.status(404).json({
                success: false,
                error: 'Email not found'
            });
        }

        return res.json({
            success: true,
            data: email
        });
    } catch (err) {
        logger.error(err);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch email'
        });
    }
});

// POST /api/v1/admin/emails/:id/reply - Reply to an email
router.post('/emails/:id/reply', async (req, res) => {
    try {
        const { replyMessage } = req.body;

        if (!replyMessage || replyMessage.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Reply message is required'
            });
        }

        const email = await Email.findById(req.params.id);

        if (!email) {
            return res.status(404).json({
                success: false,
                error: 'Email not found'
            });
        }

        // Add reply to email
        email.reply = {
            message: replyMessage.trim(),
            repliedAt: new Date(),
            repliedBy: 'admin' // You can enhance this with actual admin user info
        };

        // Update email status to replied
        email.status = 'replied';

        await email.save();

        // Optionally, send the reply via email (Nodemailer setup would go here)
        // For now, just save the reply in the database

        res.json({
            success: true,
            data: email,
            message: 'Reply sent successfully'
        });

    } catch (error) {
        logger.error('Error replying to email:', error);
        const safeError = process.env.NODE_ENV === 'development'
            ? (error && error.message) || 'Failed to send reply'
            : 'Failed to send reply';
        res.status(500).json({
            success: false,
            error: safeError
        });
    }
});

// PUT /api/v1/admin/emails/:emailId/status - Update email status only
router.put('/emails/:emailId/status', async (req, res) => {
    try {
        const emailId = (req.params.emailId || '').trim();
        const { status } = req.body || {};

        let email = null;
        if (mongoose.Types.ObjectId.isValid(emailId)) {
            email = await Email.findById(emailId);
        }

        if (!email) {
            email = await Email.findOne({ emailId });
        }

        if (!email) return res.status(404).json({ success: false, error: 'Email not found' });
        if (status) email.status = status;
        await email.save();
        return res.json({ success: true, data: email });
    } catch (err) {
        logger.error(err);
        return res.status(500).json({ success: false, error: 'Failed to update email' });
    }
});

// DELETE /api/v1/admin/emails/:emailId
router.delete('/emails/:emailId', async (req, res) => {
    try {
        const emailId = (req.params.emailId || '').trim();

        let deleted = null;
        if (mongoose.Types.ObjectId.isValid(emailId)) {
            deleted = await Email.findByIdAndDelete(emailId);
        }

        // Support optional future custom id field without breaking current data model
        if (!deleted) {
            deleted = await Email.findOneAndDelete({ emailId });
        }

        if (!deleted) {
            return res.status(404).json({ success: false, message: 'Email not found' });
        }

        return res.json({ success: true });
    } catch (err) {
        logger.error(err);
        const safeError = process.env.NODE_ENV === 'development'
            ? (err && err.message) || 'Failed to delete email'
            : 'Failed to delete email';
        return res.status(500).json({ success: false, error: safeError });
    }
});

module.exports = router;
