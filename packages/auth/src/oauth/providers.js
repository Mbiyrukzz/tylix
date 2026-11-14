// OAuth provider presets. Each returns a plain object, so a provider that
// isn't listed is just `oauthProvider({ id, authorizationUrl, tokenUrl,
// scopes, profile })`.
//
// profile() must return { id, email, emailVerified, name, avatarUrl }.
// emailVerified is only true when the provider vouches for the address.

function required(name, options) {
  for (const key of ['clientId', 'clientSecret', 'redirectUri']) {
    if (!options[key]) throw new TypeError(`${name}: missing ${key}`)
  }
}

export function oauthProvider(definition) {
  for (const key of ['id', 'authorizationUrl', 'tokenUrl', 'clientId', 'redirectUri', 'profile']) {
    if (!definition[key]) throw new TypeError(`oauthProvider: missing ${key}`)
  }
  return { scopes: [], authorizationParams: {}, clientAuth: 'post', oidc: false, ...definition }
}

export function github(options) {
  required('github', options)
  return oauthProvider({
    id: 'github',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['read:user', 'user:email'],
    ...options,
    async profile({ get }) {
      const user = await get('https://api.github.com/user')
      // The public profile email may be unverified; the emails API says.
      let email = null
      let emailVerified = false
      try {
        const emails = await get('https://api.github.com/user/emails')
        const primary = Array.isArray(emails) ? emails.find((e) => e.primary) : null
        if (primary) {
          email = primary.email
          emailVerified = primary.verified === true
        }
      } catch {}
      return { id: user.id, email, emailVerified, name: user.name ?? user.login, avatarUrl: user.avatar_url ?? null, username: user.login }
    },
  })
}

export function google(options) {
  required('google', options)
  return oauthProvider({
    id: 'google',
    oidc: true,
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'email', 'profile'],
    authorizationParams: { prompt: 'select_account' },
    ...options,
    async profile({ get }) {
      const u = await get('https://openidconnect.googleapis.com/v1/userinfo')
      return { id: u.sub, email: u.email ?? null, emailVerified: u.email_verified === true, name: u.name ?? null, avatarUrl: u.picture ?? null }
    },
  })
}

export function discord(options) {
  required('discord', options)
  return oauthProvider({
    id: 'discord',
    authorizationUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scopes: ['identify', 'email'],
    ...options,
    async profile({ get }) {
      const u = await get('https://discord.com/api/users/@me')
      const avatarUrl = u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png` : null
      return { id: u.id, email: u.email ?? null, emailVerified: u.verified === true, name: u.global_name ?? u.username, avatarUrl, username: u.username }
    },
  })
}

export function gitlab({ baseUrl = 'https://gitlab.com', ...options }) {
  required('gitlab', options)
  return oauthProvider({
    id: 'gitlab',
    oidc: true,
    authorizationUrl: `${baseUrl}/oauth/authorize`,
    tokenUrl: `${baseUrl}/oauth/token`,
    scopes: ['openid', 'email', 'profile'],
    ...options,
    async profile({ get }) {
      const u = await get(`${baseUrl}/oauth/userinfo`)
      return { id: u.sub, email: u.email ?? null, emailVerified: u.email_verified === true, name: u.name ?? u.nickname, avatarUrl: u.picture ?? null }
    },
  })
}

export function microsoft({ tenant = 'common', ...options }) {
  required('microsoft', options)
  return oauthProvider({
    id: 'microsoft',
    oidc: true,
    authorizationUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    scopes: ['openid', 'email', 'profile', 'User.Read'],
    ...options,
    async profile({ get }) {
      const u = await get('https://graph.microsoft.com/oidc/userinfo')
      // Entra ID lets tenant admins set any email on an account without
      // verifying it ("nOAuth"), so it is never treated as verified.
      return { id: u.sub, email: u.email ?? null, emailVerified: false, name: u.name ?? null, avatarUrl: null }
    },
  })
}
