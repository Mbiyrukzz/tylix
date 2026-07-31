# @tylix/auth

Authentication primitives for Tylix applications — password hashing,
tokens, cookies, and rate limiting.

## What's included

- `hashPassword` — password hashing
- `signToken` — auth token signing
- `authCookies` — cookie helpers for session/auth state
- `loginRateLimiter` — rate limiting for login attempts
- `AuthGenerator` — scaffolds auth routes/controllers/views via
  `tylix make:auth`

## Usage

```js
import { hashPassword, signToken } from '@tylix/auth'
```

Or scaffold auth into a project:
