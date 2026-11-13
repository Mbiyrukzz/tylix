<!--
  Svelte 5 wrapper.
    import { Chart } from '@tylix/charts/svelte'
    <Chart type="line" series={series} height={260} />
-->
<script>
  import { chartProps, cleanId, enhance, svgFor } from '../shared.js'

  let { class: className = '', style = '', ...rest } = $props()
  // stable between server render and hydration
  const uid = $props.id()
  const id = rest.id ?? cleanId(uid)
  let host = $state(null)

  const spec = $derived(chartProps(rest))
  const svg = $derived(svgFor(spec, id))

  $effect(() => {
    svg
    return enhance(host, spec, id)
  })
</script>

<div bind:this={host} class="tylix-chart-host {className}" {style}>{@html svg}</div>
