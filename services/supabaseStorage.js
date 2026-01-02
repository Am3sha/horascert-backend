const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const defaultBucket = process.env.STORAGE_BUCKET || 'certificates';

// Validate critical configuration
if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
}

const supabase = createClient(supabaseUrl, supabaseKey);

function sanitizeFilename(filename) {
    if (!filename || typeof filename !== 'string') return 'file';
    return filename
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_{2,}/g, '_')
        .slice(0, 180);
}

function validateStorageKey(storageKey) {
    if (!storageKey || typeof storageKey !== 'string') {
        throw new Error('Storage key must be a non-empty string');
    }

    // No leading slash
    if (storageKey.startsWith('/')) {
        throw new Error('Storage key cannot start with /');
    }

    // Prevent path traversal / malformed keys
    if (storageKey.includes('..') || storageKey.includes('\\')) {
        throw new Error(`Invalid storage key (unsafe path): ${storageKey}`);
    }

    // Must follow expected structure: requests/<ObjectId>/<anything>
    // NOTE: We intentionally allow broader filenames here because Supabase can store
    // objects with characters beyond our upload sanitizer, especially for legacy records.
    const expectedPrefix = 'requests/';
    if (!storageKey.startsWith(expectedPrefix)) {
        throw new Error(`Invalid storage key (must start with requests/): ${storageKey}`);
    }

    const parts = storageKey.split('/');
    if (parts.length < 3) {
        throw new Error(`Invalid storage key (too short): ${storageKey}`);
    }

    const requestId = parts[1];
    if (!/^[a-fA-F0-9]{24}$/.test(requestId)) {
        throw new Error(`Invalid storage key (invalid request id): ${storageKey}`);
    }

    const remainder = parts.slice(2).join('/');
    if (!remainder) {
        throw new Error(`Invalid storage key (missing filename): ${storageKey}`);
    }

    return true;
}

async function uploadFile(fileBuffer, originalName, mimeType, requestId) {
    // Validate inputs
    if (!fileBuffer || !originalName || !requestId) {
        throw new Error('fileBuffer, originalName, and requestId are required');
    }

    const safeName = sanitizeFilename(originalName);
    const timestamp = Date.now();
    const storageKey = `requests/${requestId}/${timestamp}_${safeName}`;

    // Validate the generated storageKey
    validateStorageKey(storageKey);

    logger.info('Uploading file to Supabase', {
        storageKey,
        originalName,
        safeName,
        mimeType,
        size: fileBuffer.length,
        requestId,
        bucket: defaultBucket
    });

    const { data, error } = await supabase.storage
        .from(defaultBucket)
        .upload(storageKey, fileBuffer, {
            contentType: mimeType,
            upsert: false,
        });

    if (error) {
        const structuredError = new Error(`Upload failed: ${defaultBucket}/${storageKey} -> ${error.message}`);
        structuredError.code = error.code || 'UPLOAD_FAILED';
        structuredError.bucket = defaultBucket;
        structuredError.storageKey = storageKey;
        structuredError.requestId = requestId;
        structuredError.originalError = error;
        throw structuredError;
    }

    logger.info('File uploaded successfully', {
        storageKey,
        bucket: defaultBucket,
        size: fileBuffer.length
    });

    return {
        storageKey,
        originalName,
        mimeType,
        size: fileBuffer.length,
        bucket: defaultBucket
    };
}

async function getSignedFileUrl(bucket, storageKey, expiresIn = 86400) {
    if (!bucket || typeof bucket !== 'string') {
        throw new Error('Bucket is required');
    }
    if (!storageKey || typeof storageKey !== 'string') {
        throw new Error('Storage key is required');
    }

    validateStorageKey(storageKey);

    const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(storageKey, expiresIn);

    if (error) {
        const structuredError = new Error(`Failed to create signed URL: ${bucket}/${storageKey} -> ${error.message}`);
        structuredError.code = error.code || 'SIGNED_URL_FAILED';
        structuredError.bucket = bucket;
        structuredError.storageKey = storageKey;
        structuredError.originalError = error;
        throw structuredError;
    }

    if (!data || !data.signedUrl) {
        const structuredError = new Error(`Failed to create signed URL: ${bucket}/${storageKey} -> missing signedUrl`);
        structuredError.code = 'SIGNED_URL_MISSING';
        structuredError.bucket = bucket;
        structuredError.storageKey = storageKey;
        throw structuredError;
    }

    return data.signedUrl;
}

async function deleteFile(storageKey, bucket = defaultBucket) {
    if (!bucket || typeof bucket !== 'string') {
        return {
            ok: false,
            bucket,
            storageKey,
            skipped: true,
            error: 'Invalid bucket'
        };
    }

    if (!storageKey || typeof storageKey !== 'string') {
        return {
            ok: false,
            bucket,
            storageKey,
            skipped: true,
            error: 'Invalid storageKey'
        };
    }

    try {
        validateStorageKey(storageKey);
    } catch (e) {
        logger.warn('Skipping deleteFile due to invalid storageKey', {
            bucket,
            storageKey,
            error: e.message
        });

        return {
            ok: false,
            bucket,
            storageKey,
            skipped: true,
            error: e.message
        };
    }

    // Retry logic: attempt deletion up to 2 times
    const maxRetries = 2;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const { data, error } = await supabase.storage
                .from(bucket)
                .remove([storageKey]);

            if (error) {
                lastError = error;
                logger.warn(`Supabase delete attempt ${attempt}/${maxRetries} failed`, {
                    bucket,
                    storageKey,
                    errorCode: error.code,
                    errorMessage: error.message
                });
                // Continue to next retry if not last attempt
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 500 * attempt)); // Incremental backoff
                    continue;
                }
            } else {
                // Success - return immediately
                logger.info('File deleted successfully from Supabase', {
                    bucket,
                    storageKey,
                    attempt
                });
                return {
                    ok: true,
                    bucket,
                    storageKey,
                    data
                };
            }
        } catch (err) {
            lastError = err;
            logger.warn(`Supabase delete attempt ${attempt}/${maxRetries} threw exception`, {
                bucket,
                storageKey,
                error: err.message
            });
            // Continue to next retry
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                continue;
            }
        }
    }

    // All retries exhausted - return soft failure
    logger.warn('Failed to delete file from Supabase after retries', {
        bucket,
        storageKey,
        attempts: maxRetries,
        lastError: lastError?.message || lastError
    });

    return {
        ok: false,
        bucket,
        storageKey,
        error: lastError?.message || 'Unknown error after retries',
        code: lastError?.code || 'DELETE_FAILED_RETRIES_EXHAUSTED',
        retriesFailed: true
    };
}

// Backwards-compatible wrapper (legacy callers)
async function getFileUrl(storageKey, expiresIn = 3600) {
    return getSignedFileUrl(defaultBucket, storageKey, expiresIn);
}

async function generateSignedUrl(storageKey, expiresIn = 3600) {
    return getFileUrl(storageKey, expiresIn);
}

async function listFiles(path = '') {
    const { data, error } = await supabase.storage
        .from(defaultBucket)
        .list(path);

    if (error) {
        throw error;
    }

    return data || [];
}

async function validateBucketAccess() {
    try {
        // Test bucket access by listing files
        const { data, error } = await supabase.storage
            .from(defaultBucket)
            .list('', { limit: 1 });

        if (error) {
            throw new Error(`Bucket access failed: ${error.message}`);
        }

        logger.info('✅ Supabase Storage bucket access validated', {
            bucket: defaultBucket,
            service: 'service_role_key'
        });

        return true;
    } catch (error) {
        logger.error('❌ Supabase Storage bucket access failed:', {
            bucket: defaultBucket,
            error: error.message
        });
        throw error;
    }
}

module.exports = {
    uploadFile,
    generateSignedUrl,
    getFileUrl,
    getSignedFileUrl,
    deleteFile,
    listFiles,
    validateBucketAccess,
    validateStorageKey
};
