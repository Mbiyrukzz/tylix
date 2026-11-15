import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPluginHost, definePlugin, loadPlugins } from './plugins.js'

function project(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylix-plugins-'))
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}')
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text)
  }
  return dir
}

test('loadPlugins: objects, factories, files with options, app/plugins/', async () => {
  const dir = project({
    'plugins/banner.js': 'export default (options) => ({ name: "banner", text: options.text })',
    'app/plugins/audit.js': 'export default { routes() {} }',
    'app/plugins/_off.js': 'export default { name: "off" }',
    'app/plugins/types.d.ts': '',
  })
  const plugins = await loadPlugins(dir, {
    plugins: [definePlugin({ name: 'inline' }), false, () => ({ name: 'factory' }), ['./plugins/banner.js', { text: 'Hi' }]],
  })
  assert.deepEqual(plugins.map((p) => [p.name, p.source]), [
    ['inline', 'tylix.config'],
    ['factory', 'tylix.config'],
    ['banner', './plugins/banner.js'],
    ['audit', 'app/plugins/audit.js'],
  ])
  assert.equal(plugins[2].text, 'Hi')
})

test('loadPlugins: clear errors for bad plugins', async () => {
  const dir = project()
  await assert.rejects(loadPlugins(dir, { plugins: ['@nope/missing'] }), /Plugin "@nope\/missing" is not installed/)
  await assert.rejects(loadPlugins(dir, { plugins: [{ name: 'a' }, { name: 'a' }] }), /Two plugins are named "a"/)
  await assert.rejects(loadPlugins(dir, { plugins: [{ name: 'a', boot: 1 }] }), /boot must be a function/)
})

test('host: config merge, hooks in order with labelled errors, collect, close in reverse', async () => {
  const calls = []
  const host = createPluginHost([
    { name: 'a', source: 'x', config: () => ({ extra: 1 }), boot: (app) => calls.push(['a', app]), close: () => calls.push('close a'), commands: { hi: { run() {} } } },
    { name: 'b', source: 'x', config: (c) => void (c.inPlace = true), boot: () => calls.push('b'), close: () => calls.push('close b') },
  ])
  const config = await host.applyConfig({ base: true })
  assert.deepEqual(config, { base: true, extra: 1, inPlace: true })
  await host.run('boot', 'app')
  await host.close()
  assert.deepEqual(calls, [['a', 'app'], 'b', 'close b', 'close a'])
  assert.equal(host.collect('commands').get('hi').plugin, 'a')
  assert.deepEqual(host.describe()[0].hooks, ['config', 'boot', 'close'])

  const failing = createPluginHost([{ name: 'z', routes: () => { throw new Error('nope') } }])
  await assert.rejects(failing.runWith('routes', () => []), /Plugin "z" routes\(\) failed: nope/)
  const clash = createPluginHost([{ name: 'a', commands: { x: {} } }, { name: 'b', commands: { x: {} } }])
  assert.throws(() => clash.collect('commands'), /both define commands "x"/)
})
