import bcrypt from 'bcryptjs'
import { validatePassword } from '@panshi/contracts'

export const BCRYPT_COST = 12
export const DUMMY_PASSWORD_HASH = '$2b$12$4.H7zxUk.BjAbRyDDj5Qf.gfWUm5I2wqOdlnNJWJKmL1LPVUzkvga'

const bcryptCost12Pattern = /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/u
const INVALID_PASSWORD_TIMING_VALUE = 'invalid password'

export const hashPassword = async (password: string) => bcrypt.hash(validatePassword(password), BCRYPT_COST)

export const verifyPassword = async (password: string, passwordHash: string): Promise<boolean> => {
  let validPassword = true
  try {
    validatePassword(password)
  } catch {
    validPassword = false
  }

  const validHash = bcryptCost12Pattern.test(passwordHash)
  const compared = await bcrypt.compare(
    validPassword ? password : INVALID_PASSWORD_TIMING_VALUE,
    validHash ? passwordHash : DUMMY_PASSWORD_HASH,
  ).catch(() => false)
  return validPassword && validHash && compared
}
