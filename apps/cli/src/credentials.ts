import { AsyncEntry } from '@napi-rs/keyring'
import { CliRuntimeError } from './errors.js'

const SERVICE = 'cn.ac.tashan.panshi-camp'
const account = (profile: string) => `${profile}:cli-session`

export interface CredentialStore {
  get(profile: string): Promise<string | null>
  set(profile: string, token: string): Promise<void>
  delete(profile: string): Promise<void>
}

export type KeychainAdapter = {
  getPassword(service: string, account: string): Promise<string | null>
  setPassword(service: string, account: string, password: string): Promise<void>
  deletePassword(service: string, account: string): Promise<unknown>
}

const nativeAdapter: KeychainAdapter = {
  getPassword: async (service, username) => await new AsyncEntry(service, username).getPassword() ?? null,
  setPassword: async (service, username, password) => new AsyncEntry(service, username).setPassword(password),
  deletePassword: async (service, username) => new AsyncEntry(service, username).deleteCredential(),
}

export class KeychainCredentialStore implements CredentialStore {
  constructor(private readonly adapter: KeychainAdapter = nativeAdapter) {}
  async get(profile: string) { try { return await this.adapter.getPassword(SERVICE, account(profile)) } catch { throw new CliRuntimeError('KEYCHAIN_UNAVAILABLE') } }
  async set(profile: string, token: string) { try { await this.adapter.setPassword(SERVICE, account(profile), token) } catch { throw new CliRuntimeError('KEYCHAIN_UNAVAILABLE') } }
  async delete(profile: string) { try { await this.adapter.deletePassword(SERVICE, account(profile)) } catch { throw new CliRuntimeError('KEYCHAIN_UNAVAILABLE') } }
}
