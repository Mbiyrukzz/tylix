import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { createProgressBar } from './progress.js'

function fakeTty() {
  const out = []
  return {
    isTTY: true,
    columns: 60,
    write: (s) => out.push(s),
    // readline.moveCursor / clearScreenDown call these on the stream.
    moveCursor: () => true,
    clearScreenDown: () => true,
    frames: () => out.join('').replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''),
  }
}

test('weights give a heavy step its share of the bar', () => {
  const stream = fakeTty()
  const bar = createProgressBar([1, 3], { stream })
  bar.render('Two', 1)
  assert.match(stream.frames(), /25%\n$/)
  bar.render('Done', 2)
  assert.match(stream.frames(), /100%\n$/)
})

test('the last throttled update is still drawn', async () => {
  const stream = fakeTty()
  const bar = createProgressBar([1], { stream })
  bar.render('Installing packages', 0)
  bar.update('Installing packages', 0, 0.2, 'first')
  bar.update('Installing packages', 0, 0.5, 'last of the burst')
  assert.doesNotMatch(stream.frames(), /last of the burst/)
  await sleep(150)
  assert.match(stream.frames(), /last of the burst\n.* 50%\n$/)
})

test('the bar never goes backwards', async () => {
  const stream = fakeTty()
  const bar = createProgressBar([1], { stream })
  bar.render('Installing packages', 0)
  await sleep(100)
  bar.update('Installing packages', 0, 0.6, 'a')
  bar.render('Installing packages', 0, 'retrying')
  assert.match(stream.frames(), /retrying\n.* 60%\n$/)
})
