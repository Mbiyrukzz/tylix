# tylix-icons

A set of common UI icon components for Tylix pages and components.

## Usage

```
page Dashboard

import { IconPlus, IconTrash } from "tylix-icons"

template
  <button onclick="{{ createPost() }}">
    <IconPlus class="w-4 h-4" /> New Post
  </button>
```

Every icon accepts an optional `class` prop (defaults to `"w-5 h-5"`),
so size and color pass through the same way any Tailwind utility class
would: `<IconTrash class="w-5 h-5 text-rose-400" />`.

## What's included

89 icons across a few common categories: navigation/arrows, status/
feedback, basic actions, people/account, communication, media/files,
commerce, data/system, location/calendar, and general/weather. See
`tylix-components.json` for the full list of exported names, or just
look at the file names under `icons/`.

## Adding your own

`tylix-components.json` is a plain manifest mapping an exported name
to the `.tyx` file that defines it:

```json
{
  "IconYourIcon": "icons/IconYourIcon.tyx"
}
```

Any Tylix component (a file with a `props`/`template` section, same
shape `tylix make:icon` generates) can be added the same way — this
package is just a folder of `.tyx` files plus that manifest, nothing
more specialized.

## License

MIT. All icon paths in this package are original, hand-authored
geometry — not traced or copied from any other icon library.
