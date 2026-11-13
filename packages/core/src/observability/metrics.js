// Counters, gauges and histograms, rendered in the Prometheus text format
// at /metrics (METRICS=true). No dependencies.
//
//   const sent = metrics.counter('invoices_sent_total', 'Invoices sent', ['channel'])
//   sent.inc({ channel: 'email' })
//   const timer = metrics.histogram('pdf_render_seconds', 'PDF render time')
//   timer.observe(0.42)

const escapeLabel = (value) => String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')

function labelText(labels) {
  const entries = Object.entries(labels)
  return entries.length ? `{${entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(',')}}` : ''
}

const keyOf = (labels) => JSON.stringify(Object.entries(labels).sort())

export const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

export function createRegistry() {
  const metrics = new Map()

  function define(name, help, type, create) {
    if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) throw new Error(`Invalid metric name "${name}".`)
    const existing = metrics.get(name)
    if (existing) {
      if (existing.type !== type) throw new Error(`Metric "${name}" already exists as a ${existing.type}.`)
      return existing.api
    }
    const metric = { name, help, type, ...create() }
    metrics.set(name, metric)
    return metric.api
  }

  return {
    counter(name, help) {
      return define(name, help, 'counter', () => {
        const values = new Map()
        return {
          values,
          api: {
            inc(labels = {}, by = 1) {
              const key = keyOf(labels)
              const entry = values.get(key)
              if (entry) entry.value += by
              else values.set(key, { labels, value: by })
            },
          },
        }
      })
    },

    // collect() is called at render time: gauge.set() for values you
    // track, or pass collect for values read on demand.
    gauge(name, help, collect) {
      return define(name, help, 'gauge', () => {
        const values = new Map()
        return {
          values,
          collect,
          api: {
            set(value, labels = {}) {
              values.set(keyOf(labels), { labels, value })
            },
          },
        }
      })
    },

    histogram(name, help, buckets = DEFAULT_BUCKETS) {
      return define(name, help, 'histogram', () => {
        const values = new Map()
        return {
          values,
          buckets,
          api: {
            observe(value, labels = {}) {
              const key = keyOf(labels)
              let entry = values.get(key)
              if (!entry) {
                entry = { labels, counts: new Array(buckets.length).fill(0), sum: 0, count: 0 }
                values.set(key, entry)
              }
              entry.sum += value
              entry.count++
              for (let i = 0; i < buckets.length; i++) if (value <= buckets[i]) entry.counts[i]++
            },
          },
        }
      })
    },

    render() {
      const lines = []
      for (const metric of metrics.values()) {
        if (metric.collect) {
          const collected = metric.collect()
          if (typeof collected === 'number') metric.values.set('[]', { labels: {}, value: collected })
          else if (Array.isArray(collected)) {
            for (const { labels = {}, value } of collected) metric.values.set(keyOf(labels), { labels, value })
          }
        }
        lines.push(`# HELP ${metric.name} ${metric.help}`, `# TYPE ${metric.name} ${metric.type}`)
        for (const entry of metric.values.values()) {
          if (metric.type !== 'histogram') {
            lines.push(`${metric.name}${labelText(entry.labels)} ${entry.value}`)
            continue
          }
          metric.buckets.forEach((le, i) => {
            lines.push(`${metric.name}_bucket${labelText({ ...entry.labels, le })} ${entry.counts[i]}`)
          })
          lines.push(`${metric.name}_bucket${labelText({ ...entry.labels, le: '+Inf' })} ${entry.count}`)
          lines.push(`${metric.name}_sum${labelText(entry.labels)} ${entry.sum}`)
          lines.push(`${metric.name}_count${labelText(entry.labels)} ${entry.count}`)
        }
      }
      return lines.join('\n') + '\n'
    },

    reset() {
      metrics.clear()
    },
  }
}

// The app's metrics. The server records HTTP metrics here; add your own.
export const metrics = createRegistry()
