export interface AuthGeneratorResults {
  userModel: string
  refreshTokenModel: string
  passwordResetModel: string
  validator: string
  controller: string
  mailer: string
  userMigration: string
  refreshTokenMigration: string
  passwordResetMigration: string
}

export declare class AuthGenerator {
  generate(baseDir: string): Promise<AuthGeneratorResults>
}