const Certificate = require('../models/Certificate');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { sendCertificateNotification } = require('../config/email');
const { ApiError } = require('../middleware/errorHandler');
const { certificateCache } = require('../utils/cache');
const logger = require('../utils/logger');

const mapStatus = (s) => String(s || '').toLowerCase();
const normalizeCertificateStatus = (doc) => {
    if (!doc || typeof doc !== 'object') return doc;
    const out = { ...doc };
    if (Object.prototype.hasOwnProperty.call(out, 'status')) {
        out.status = mapStatus(out.status);
    }
    return out;
};

/**
 * @desc    Create a new certificate
 * @route   POST /api/certificates
 * @access  Private/Admin
 * 
 * IMPORTANT: Returns 202 Accepted immediately after validation and DB insert.
 * Heavy operations (email, QR code) happen in background.
 */
const createCertificate = async (req, res, next) => {
    try {
        const {
            certificateNumber,
            companyName,
            issueDate,
            expiryDate,
            companyAddress,
            standard,
            standardDescription,
            scope
        } = req.body;

        // Validate required fields
        if (!certificateNumber || !companyName || !issueDate || !expiryDate || !standard || !scope) {
            return next(new ApiError(400, 'Missing required fields'));
        }

        // Check for duplicate
        const existing = await Certificate.findOne({ certificateNumber: String(certificateNumber).trim() });
        if (existing) {
            return next(new ApiError(400, 'Certificate number already exists'));
        }

        const generatedCertificateId = uuidv4().replace(/-/g, '').substring(0, 24);

        let parsedAddress = companyAddress;
        if (typeof companyAddress === 'string') {
            const addr = companyAddress;
            parsedAddress = {
                fullAddress: addr,
                street: addr.split(',')[0] || '',
                city: addr.split(',')[1] ? addr.split(',')[1].trim() : '',
                country: 'Egypt'
            };
        }

        // Backend only returns certificateId - Frontend constructs URLs using window.location.origin
        // This ensures URLs are always correct regardless of domain

        // Create certificate record in DB
        const certificate = await Certificate.create({
            certificateId: generatedCertificateId,
            certificateNumber: String(certificateNumber).trim(),
            companyName,
            companyAddress: parsedAddress,
            standard,
            standardDescription,
            scope,
            certificationType: 'Management System',
            issueDate: new Date(issueDate),
            expiryDate: new Date(expiryDate),
            firstIssueDate: new Date(issueDate),
            createdBy: req.user.id
        });

        // ✅ RETURN IMMEDIATELY (202 Accepted)
        // Background tasks continue processing without blocking the client
        res.status(202).json({
            success: true,
            message: 'Certificate created and processing',
            data: normalizeCertificateStatus(certificate.toObject())
            // ✅ NO certificateUrl returned - Frontend builds URLs using window.location.origin
        });

        // 🔄 BACKGROUND PROCESSING (non-blocking)
        // Send notification email asynchronously without awaiting
        setImmediate(async () => {
            try {
                await sendCertificateNotification(certificate);
                logger.info(`Notification email sent for certificate ${certificate.certificateNumber}`);
            } catch (emailError) {
                // Log error but don't crash - email failure shouldn't block certificate creation
                logger.error(`Failed to send notification email for ${certificate.certificateNumber}:`, emailError);
            }
        });

    } catch (error) {
        logger.error('Error creating certificate:', error);
        next(error);
    }
};

/**
 * @desc    Get all certificates
 * @route   GET /api/certificates
 * @access  Public
 */
const getCertificates = async (req, res, next) => {
    try {
        const coerceQueryValue = (value) => {
            if (Array.isArray(value)) return String(value[0]);
            return String(value);
        };

        const escapeRegex = (value) => {
            return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        };

        const allowedFilterFields = [
            'status',
            'companyName',
            'standard',
            'certificateNumber',
            'certificateId'
        ];

        const filters = {};
        Object.keys(req.query || {}).forEach((key) => {
            if (allowedFilterFields.includes(key)) {
                filters[key] = coerceQueryValue(req.query[key]);
            }
        });

        if (req.query.search) {
            const raw = coerceQueryValue(req.query.search).slice(0, 200);
            const search = escapeRegex(raw);
            filters.$or = [
                { companyName: { $regex: search, $options: 'i' } },
                { certificateNumber: { $regex: search, $options: 'i' } }
            ];
        }

        const publicFields = [
            'certificateId',
            'certificateNumber',
            'companyName',
            'companyAddress',
            'standard',
            'standardDescription',
            'certificationType',
            'status',
            'statusDescription',
            'issueDate',
            'expiryDate',
            'firstIssueDate',
            'scope',
            'qrCodeUrl',
            'sites',
            'technicalSectors',
            'certificationBody',
            'accreditationBody',
            'assessmentAssociation',
            'createdAt',
            'updatedAt'
        ];

        let query = Certificate.find(filters).select(publicFields.join(' '));

        // Sorting
        if (req.query.sort) {
            const sortBy = req.query.sort.split(',').join(' ');
            query = query.sort(sortBy);
        } else {
            query = query.sort('-createdAt');
        }

        // Pagination with sensible limits
        let page = parseInt(req.query.page, 10) || 1;
        let limit = parseInt(req.query.limit, 10) || 10;

        // Ensure page is at least 1
        page = Math.max(1, page);
        // Enforce maximum limit to prevent huge queries
        limit = Math.min(Math.max(1, limit), 100);

        const skip = (page - 1) * limit;
        const endIndex = page * limit;

        // Count documents only once, use countDocuments without extra calls
        const total = await Certificate.countDocuments(filters);

        // Use lean() for read-only queries to improve performance
        query = query.skip(skip).limit(limit).lean();

        const certificates = (await query).map((c) => normalizeCertificateStatus(c));

        const pagination = {};
        if (endIndex < total) {
            pagination.next = { page: page + 1, limit };
        }
        if (skip > 0) {
            pagination.prev = { page: page - 1, limit };
        }

        res.status(200).json({
            success: true,
            page,
            limit,
            total,
            count: certificates.length,
            pagination,
            data: certificates
        });
    } catch (error) {
        logger.error('Error fetching certificates:', error);
        next(error);
    }
};

const getCertificateQrPng = async (req, res, next) => {
    try {
        const lookup = (req.params.id || '').trim();
        let certificate = await Certificate.findOne({ certificateId: lookup }).select('certificateId certificateNumber');

        if (!certificate) {
            certificate = await Certificate.findOne({ certificateNumber: lookup }).select('certificateId certificateNumber');
        }

        if (!certificate && mongoose.Types.ObjectId.isValid(lookup)) {
            certificate = await Certificate.findById(lookup).select('certificateId certificateNumber');
        }

        if (!certificate) {
            return next(new ApiError(404, 'Certificate not found'));
        }

        // NOTE: QR Code generation moved to Frontend
        // Backend no longer generates QRs because it doesn't know the frontend domain
        // Frontend generates QRs using the current domain (window.location.origin)

        if (!certificate) {
            return next(new ApiError(404, 'Certificate not found'));
        }

        // Return 404 - QR generation now happens in Frontend only
        return next(new ApiError(410, 'QR endpoint deprecated - QR codes are generated in Frontend'));
    } catch (error) {
        logger.error('Error generating certificate QR:', error);
        return next(error);
    }
};

/**
 * @desc    Get single certificate by certificate number
 * @route   GET /api/certificates/:certificateNumber
 * @access  Public
 */
const getCertificate = async (req, res, next) => {
    try {
        const lookup = (req.params.certificateNumber || '').trim();
        const publicFields = [
            'certificateId',
            'certificateNumber',
            'companyName',
            'companyAddress',
            'standard',
            'standardDescription',
            'certificationType',
            'status',
            'statusDescription',
            'issueDate',
            'expiryDate',
            'firstIssueDate',
            'scope',
            'qrCodeUrl',
            'sites',
            'technicalSectors',
            'certificationBody',
            'accreditationBody',
            'assessmentAssociation',
            'createdAt',
            'updatedAt'
        ];

        let certificate = await Certificate.findOne({
            $or: [
                { certificateNumber: lookup },
                { certificateId: lookup }
            ]
        }).select(publicFields.join(' '));

        if (!certificate && mongoose.Types.ObjectId.isValid(lookup)) {
            certificate = await Certificate.findById(lookup).select(publicFields.join(' '));
        }

        if (!certificate) {
            return next(new ApiError(404, `Certificate not found with number ${lookup}`));
        }

        const normalized = normalizeCertificateStatus(certificate.toObject ? certificate.toObject() : certificate);
        res.status(200).json({
            success: true,
            data: normalized
        });
    } catch (error) {
        logger.error('Error fetching certificate:', error);
        next(error);
    }
};

/**
 * @desc    Update certificate
 * @route   PUT /api/certificates/:id
 * @access  Private/Admin
 */
const updateCertificate = async (req, res, next) => {
    try {
        let certificate = await Certificate.findById(req.params.id);

        if (!certificate) {
            return next(new ApiError(404, `Certificate not found with id ${req.params.id}`));
        }

        if (certificate.createdBy.toString() !== req.user.id && req.user.role !== 'admin') {
            return next(new ApiError(403, 'Not authorized to update this certificate'));
        }

        const allowedFields = [
            'certificateNumber',
            'companyName',
            'companyAddress',
            'standard',
            'standardDescription',
            'scope',
            'issueDate',
            'expiryDate',
            'firstIssueDate',
            'status',
            'adminNotes'
        ];

        const updates = {};
        for (const key of allowedFields) {
            if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
                updates[key] = req.body[key];
            }
        }

        if (typeof updates.companyAddress === 'string') {
            const addr = updates.companyAddress;
            updates.companyAddress = {
                fullAddress: addr,
                street: addr.split(',')[0] || '',
                city: addr.split(',')[1] ? addr.split(',')[1].trim() : '',
                country: 'Egypt'
            };
        }

        if (updates.issueDate) updates.issueDate = new Date(updates.issueDate);
        if (updates.expiryDate) updates.expiryDate = new Date(updates.expiryDate);
        if (updates.firstIssueDate) updates.firstIssueDate = new Date(updates.firstIssueDate);

        certificate = await Certificate.findByIdAndUpdate(req.params.id, updates, {
            new: true,
            runValidators: true
        });

        // Invalidate cache for this certificate (number may have changed)
        if (certificate.certificateNumber) {
            certificateCache.delete(`verify_${certificate.certificateNumber}`);
            logger.info('Certificate verification cache cleared after update', {
                certificateNumber: certificate.certificateNumber
            });
        }

        res.status(200).json({
            success: true,
            data: normalizeCertificateStatus(certificate.toObject ? certificate.toObject() : certificate)
        });
    } catch (error) {
        logger.error('Error updating certificate:', error);
        next(error);
    }
};

/**
 * @desc    Delete certificate
 * @route   DELETE /api/certificates/:id
 * @access  Private/Admin
 */
const deleteCertificate = async (req, res, next) => {
    try {
        const certificate = await Certificate.findById(req.params.id);

        if (!certificate) {
            return next(new ApiError(404, `Certificate not found with id ${req.params.id}`));
        }

        if (req.user.role !== 'admin') {
            return next(new ApiError(403, 'Not authorized to delete this certificate'));
        }

        // Get certificate number before deletion for cache cleanup
        const certNumber = certificate.certificateNumber;

        await certificate.remove();

        // Invalidate cache for this certificate
        if (certNumber) {
            certificateCache.delete(`verify_${certNumber}`);
            logger.info('Certificate verification cache cleared after deletion', {
                certificateNumber: certNumber
            });
        }

        res.status(200).json({
            success: true,
            data: {}
        });
    } catch (error) {
        logger.error('Error deleting certificate:', error);
        next(error);
    }
};

/**
 * @desc    Verify certificate
 * @route   GET /api/certificates/verify/:certificateNumber
 * @access  Public
 */
const verifyCertificate = async (req, res, next) => {
    try {
        const certNumber = req.params.certificateNumber.trim();
        const cacheKey = `verify_${certNumber}`;

        // Check cache first
        const cached = certificateCache.get(cacheKey);
        if (cached) {
            logger.info('Certificate verification served from cache', { certificateNumber: certNumber });
            return res.status(200).json(cached);
        }

        const certificate = await Certificate.findOne({
            certificateNumber: certNumber
        }).lean(); // Use lean for read-only operation

        if (!certificate) {
            return next(new ApiError(404, `No active certificate found with number ${certNumber}`));
        }

        if (certificate.expiryDate && certificate.expiryDate < new Date()) {
            return next(new ApiError(400, 'This certificate has expired'));
        }

        if (certificate.status && certificate.status !== 'active') {
            return next(new ApiError(400, `This certificate is not active (status: ${certificate.status})`));
        }

        const responseData = {
            success: true,
            data: {
                isValid: true,
                certificate: {
                    companyName: certificate.companyName,
                    certificateNumber: certificate.certificateNumber.trim(),
                    issueDate: certificate.issueDate,
                    expiryDate: certificate.expiryDate,
                    standard: certificate.standard,
                    status: mapStatus(certificate.status)
                }
            }
        };

        // Cache the successful response for 5 minutes
        certificateCache.set(cacheKey, responseData);
        logger.info('Certificate verification cached', { certificateNumber: certNumber });

        res.status(200).json(responseData);
    } catch (error) {
        logger.error('Error verifying certificate:', error);
        next(error);
    }
};

const deleteCertificateByCertificateId = async (req, res) => {
    try {
        const certificateId = (req.params.certificateId || '').trim();

        let cert = await Certificate.findOne({ certificateId });
        if (!cert && mongoose.Types.ObjectId.isValid(certificateId)) {
            cert = await Certificate.findById(certificateId);
        }

        if (!cert) {
            return res.status(404).json({ success: false, error: 'NotFound', message: 'Certificate not found' });
        }

        await cert.deleteOne();
        return res.json({ success: true });
    } catch (err) {
        logger.error('Error deleting certificate by certificateId:', err);
        const message = process.env.NODE_ENV === 'development'
            ? (err && err.message) || 'An internal server error occurred'
            : 'An internal server error occurred';
        return res.status(500).json({ success: false, error: 'ServerError', message });
    }
};

const updateCertificateByCertificateId = async (req, res) => {
    try {
        const certificateId = (req.params.certificateId || '').trim();

        const allowedFields = [
            'certificateNumber',
            'companyName',
            'companyAddress',
            'standard',
            'standardDescription',
            'scope',
            'issueDate',
            'expiryDate',
            'firstIssueDate',
            'status',
            'adminNotes'
        ];

        const updates = {};
        for (const key of allowedFields) {
            if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
                updates[key] = req.body[key];
            }
        }

        if (typeof updates.companyAddress === 'string') {
            const addr = updates.companyAddress;
            updates.companyAddress = {
                fullAddress: addr,
                street: addr.split(',')[0] || '',
                city: addr.split(',')[1] ? addr.split(',')[1].trim() : '',
                country: 'Egypt'
            };
        }

        if (updates.issueDate) updates.issueDate = new Date(updates.issueDate);
        if (updates.expiryDate) updates.expiryDate = new Date(updates.expiryDate);
        if (updates.firstIssueDate) updates.firstIssueDate = new Date(updates.firstIssueDate);

        updates.lastUpdatedAt = new Date();

        let cert = await Certificate.findOneAndUpdate(
            { certificateId },
            updates,
            { new: true, runValidators: true }
        );

        if (!cert && mongoose.Types.ObjectId.isValid(certificateId)) {
            cert = await Certificate.findByIdAndUpdate(
                certificateId,
                updates,
                { new: true, runValidators: true }
            );
        }

        if (!cert) {
            return res.status(404).json({ success: false, error: 'NotFound', message: 'Certificate not found' });
        }

        return res.json({ success: true, data: normalizeCertificateStatus(cert.toObject ? cert.toObject() : cert) });
    } catch (err) {
        logger.error('Error updating certificate by certificateId:', err);
        const message = process.env.NODE_ENV === 'development'
            ? (err && err.message) || 'An internal server error occurred'
            : 'An internal server error occurred';
        return res.status(500).json({ success: false, error: 'ServerError', message });
    }
};

module.exports = {
    createCertificate,
    getCertificates,
    getCertificate,
    updateCertificate,
    deleteCertificate,
    verifyCertificate,
    deleteCertificateByCertificateId,
    updateCertificateByCertificateId,
    getCertificateQrPng
};
