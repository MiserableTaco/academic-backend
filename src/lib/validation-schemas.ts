import { z } from 'zod';

/**
 * Validation Schemas for AcadCert Backend
 * Uses Zod for runtime type validation and data sanitization
 */

// ============================================
// AUTH SCHEMAS
// ============================================

export const RequestOTPSchema = z.object({
  email: z.string()
    .email('Invalid email format')
    .min(3, 'Email too short')
    .max(255, 'Email too long')
    .toLowerCase()
    .trim()
});

export const VerifyOTPSchema = z.object({
  email: z.string()
    .email('Invalid email format')
    .toLowerCase()
    .trim(),
  code: z.string()
    .regex(/^\d{6}$/, 'OTP must be exactly 6 digits')
    .length(6, 'OTP must be 6 digits')
});

// ============================================
// DOCUMENT SCHEMAS
// ============================================

export const UploadDocumentFieldsSchema = z.object({
  recipientEmail: z.string()
    .email('Invalid recipient email')
    .toLowerCase()
    .trim(),
  documentType: z.string()
    .min(1, 'Document type is required')
    .max(50, 'Document type too long')
    .trim()
    .default('Certificate'),
  supersede: z.enum(['true', 'false'])
    .transform(val => val === 'true')
    .default('false')
});

export const RevokeDocumentSchema = z.object({
  reason: z.string()
    .min(10, 'Revocation reason must be at least 10 characters')
    .max(500, 'Revocation reason too long')
    .trim()
});

export const DocumentIdSchema = z.object({
  id: z.string()
    .regex(/^doc_\d+_[a-z0-9]+$/, 'Invalid document ID format')
});

// ============================================
// ADMIN SCHEMAS
// ============================================

export const BulkUploadSchema = z.object({
  email: z.string().email('Invalid email in CSV'),
  role: z.enum(['ADMIN', 'ISSUER', 'STUDENT'], {
    errorMap: () => ({ message: 'Invalid role in CSV' })
  }),
  institutionId: z.string().min(1, 'Institution ID required in CSV')
});

export const UserIdSchema = z.object({
  id: z.string()
    .regex(/^user_\d+_[a-z0-9]+$/, 'Invalid user ID format')
});

export const InstitutionIdSchema = z.object({
  id: z.string()
    .regex(/^inst_[a-z0-9_]+$/, 'Invalid institution ID format')
});

// ============================================
// HELPER FUNCTIONS
// ============================================

export function validateBody<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}

export function validateParams<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}

export function safeValidate<T>(schema: z.ZodSchema<T>, data: unknown) {
  return schema.safeParse(data);
}

// ============================================
// FILE VALIDATION
// ============================================

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const MAX_CSV_SIZE = 5 * 1024 * 1024;   // 5MB
export const ALLOWED_MIME_TYPES = ['application/pdf'];

export function validateFileSize(size: number, maxSize: number = MAX_FILE_SIZE): boolean {
  return size > 0 && size <= maxSize;
}

export function validateMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.includes(mimeType);
}

// ============================================
// RATE LIMIT CONFIGS
// ============================================

export const RATE_LIMITS = {
  OTP_REQUEST: { max: 5, timeWindow: '15 minutes' },
  OTP_VERIFY: { max: 10, timeWindow: '15 minutes' },
  DOCUMENT_UPLOAD: { max: 10, timeWindow: '15 minutes' },
  DOCUMENT_LIST: { max: 60, timeWindow: '1 minute' },
  ADMIN_READ: { max: 30, timeWindow: '1 minute' },
  ADMIN_WRITE: { max: 10, timeWindow: '1 minute' },
  ADMIN_DELETE: { max: 5, timeWindow: '1 minute' },
  USER_LIST: { max: 30, timeWindow: '1 minute' }
};
