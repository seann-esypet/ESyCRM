/**
 * Normalize phone number by removing all non-digit characters and country codes
 * Examples:
 * - "(555) 123-4567" -> "5551234567"
 * - "+1-555-123-4567" -> "5551234567"
 * - "+1 (555) 123-4567" -> "5551234567"
 */
export function normalizePhoneNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  
  // Remove all non-digit characters
  const digitsOnly = phone.replace(/\D/g, '');
  
  // Remove country code +1 if present (11 digits starting with 1)
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return digitsOnly.substring(1);
  }
  
  return digitsOnly || null;
}

/**
 * Normalize name for comparison (trim and lowercase)
 */
export function normalizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  return name.trim().toLowerCase() || null;
}

/**
 * Normalize email for comparison (trim and lowercase)
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.trim().toLowerCase() || null;
}
