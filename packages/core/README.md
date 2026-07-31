# @tylix/core

The Tylix framework runtime — HTTP server, routing, feature discovery,
queues, scheduling, and channels.

## What's included

- **HTTP** — `Server`, `enhanceResponse`, `parseBody`, `parseQuery`,
  `parseCookies`, `requireAuth`
- **Routing** — `Router`
- **Discovery** — `discoverFeatures`, `registerFeatureRoutes`,
  `loadCustomRoutes` — auto-wires generated features into routes
- **Queue** — `JobRecord`, `dispatch`, run via `tylix queue:work`
- **Scheduling** — `Scheduler`, run via `tylix schedule:work`
- **Channels** — `ChannelServer` (WebSocket-based), run via
  `tylix channels:work`
- **Cache** — `CacheRecord`, `Cache`

## Usage

```js
import { Server, Router } from '@tylix/core'
```

Most of this runs implicitly under `tylix dev` / `tylix build` rather
than being wired up by hand.

## License

MIT
