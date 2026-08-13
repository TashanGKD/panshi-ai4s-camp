import bcrypt from 'bcryptjs'
import { parsePhoneNumberFromString } from 'libphonenumber-js'

export const BCRYPT_COST = 12
export const DUMMY_PASSWORD_HASH = '$2b$12$4.H7zxUk.BjAbRyDDj5Qf.gfWUm5I2wqOdlnNJWJKmL1LPVUzkvga'

export const normalizeMainlandChinaPhone = (input: string): string => {
  const phone = parsePhoneNumberFromString(input.trim(), 'CN')
  if (!phone || phone.country !== 'CN' || !phone.isValid()) {
    throw new Error('Invalid mainland China phone number')
  }
  return phone.number
}

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_COST)
export const verifyPassword = (password: string, passwordHash: string) => bcrypt.compare(password, passwordHash)
