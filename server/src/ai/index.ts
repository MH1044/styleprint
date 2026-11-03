export {
  chatCompletion,
  createEmbeddings,
  resolveCredentials,
  getWallet,
  provision,
  selfTest,
  APP_SLUG,
  APP_VERSION,
  NoCredentialsError,
} from "./client.js";
export type { WalletStatus } from "./client.js";
export { readCredentialFile, writeCredentialFile, clearUserKey } from "./credentials.js";
export type { CredentialFile } from "./credentials.js";
