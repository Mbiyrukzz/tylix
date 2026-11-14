export interface AuthGeneratorResults {
  userModel: string
  sessionModel: string
  passwordResetModel: string
  validator: string
  controller: string
  mailer: string
  verifyEmailMail: string
  resetPasswordMail: string
  verifyEmailView: string
  resetPasswordView: string
  userMigration: string
  sessionMigration: string
  passwordResetMigration: string
  userObserver: string
  welcomeJob: string
}

export declare class AuthGenerator {
  generate(baseDir: string): Promise<AuthGeneratorResults>
}
