# tylix-icons

537 outline icons (24×24, stroke 1.5, round caps) for every Tylix frontend.
Every new Tylix app already depends on it, so you don't need another icon
package.

## Usage

Native Tylix (`.tyx`):

```
page Dashboard

import { IconPlus, IconTrash } from "tylix-icons"

template
  <button onclick="{{ createPost() }}">
    <IconPlus class="w-4 h-4" /> New Post
  </button>
```

React:

```jsx
import { IconBell } from 'tylix-icons/react'

<IconBell />
<IconBell size={16} className="text-rose-500" title="Notifications" />
```

Vue:

```vue
<script setup>
import { IconBell } from 'tylix-icons/vue'
</script>

<template>
  <IconBell class="w-4 h-4 text-rose-500" />
</template>
```

Svelte:

```svelte
<script>
  import { IconBell } from 'tylix-icons/svelte'
</script>

<IconBell class="w-4 h-4 text-rose-500" />
```

Angular (list the icons in the component's `imports`):

```ts
import { IconBell } from 'tylix-icons/angular'

@Component({
  imports: [IconBell],
  template: `<icon-bell class="w-4 h-4 text-rose-500" />`,
})
```

## Props

| Prop          | Default | |
| ------------- | ------- | --- |
| `size`        | 20 (Angular: 1.25rem) | width and height; classes such as `w-4 h-4` override it |
| `strokeWidth` | 1.5 | |
| `title`       | none | names the icon for screen readers; without it the icon is decorative (`aria-hidden`) |

Icons draw with `currentColor`, so text colour classes colour them. Other
attributes (`class`, `style`, `onClick` …) go to the `<svg>`.

Each icon is its own module or a pure call, so a bundle only contains the
icons it imports.

## Adding or changing icons

Icons live in `src/icons.json`, one line of SVG markup each, drawn on a
24×24 grid (`path`, `circle`, `rect` and `ellipse`; the round caps, stroke
and size come from the wrapper). After editing it:

```sh
npm run generate   # rewrites icons/, react/, vue/, svelte/, angular/, data/
npm test
```

`tylix-icons/data` exports the raw markup, for building your own wrapper.
