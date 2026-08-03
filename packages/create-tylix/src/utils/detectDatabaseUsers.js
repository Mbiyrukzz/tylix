import { execSync } from 'node:child_process'

// Postgres system/internal roles that show up in pg_roles but are
// never something a dev would pick as "the database user" -- filtered
// out so the picker only shows real, usable roles.
const POSTGRES_NOISE_ROLES = new Set([
  'pg_signal_backend',
  'pg_read_all_stats',
  'pg_write_server_files',
  'pg_read_server_files',
  'pg_execute_server_program',
  'pg_monitor',
  'pg_read_all_settings',
  'pg_stat_scan_tables',
  'pg_checkpoint',
  'pg_use_reserved_connections',
  'pg_create_subscription',
  'pg_database_owner',
])

// Attempts to list real users/roles directly from a local database
// server, relying on whatever passwordless local auth might already
// be configured (peer/trust auth for Postgres, auth_socket or a
// blank root password for MySQL -- both common on fresh dev
// installs). stdio: 'pipe' means no TTY is attached, so if the
// server *does* require a password, the client fails immediately
// instead of hanging on an interactive prompt. Returns an array of
// usernames on success, or null if detection wasn't possible (client
// not installed, auth required, no local server running, etc.) --
// null is the signal for callers to fall back to a manual picker.
export function detectDatabaseUsers(driver) {
  try {
    if (driver === 'postgres') {
      const out = execSync(
        `psql -U postgres -h 127.0.0.1 -tAc "SELECT rolname FROM pg_roles WHERE rolcanlogin = true"`,
        { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 },
      ).toString()

      const users = out
        .split('\n')
        .map((line) => line.trim())
        .filter(
          (name) =>
            name && !name.startsWith('pg_') && !POSTGRES_NOISE_ROLES.has(name),
        )

      return users.length ? users : null
    }

    if (driver === 'mysql') {
      const out = execSync(
        `mysql -u root -h 127.0.0.1 -N -e "SELECT DISTINCT User FROM mysql.user WHERE User != ''"`,
        { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 },
      ).toString()

      const users = out
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

      return users.length ? users : null
    }

    return null
  } catch {
    // Client missing, no local server, auth required, timed out --
    // any of these just mean "couldn't detect", not an error worth
    // surfacing to the user.
    return null
  }
}
