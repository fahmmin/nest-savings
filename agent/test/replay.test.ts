import { test } from 'node:test'
import assert from 'node:assert/strict'
import { replay } from '../src/replay.ts'

test('a 40% crash: the floor exits and saves money', () => {
  const r = replay('growth', 15, 40)
  assert.equal(r.points.length, 60)
  assert.equal(r.startUsd, 1000)
  assert.ok(r.exitedAt !== undefined && r.exitedAt > 15 && r.exitedAt < 35, String(r.exitedAt))
  assert.ok(r.savedUsd > 0, String(r.savedUsd))
  const at = r.points[r.exitedAt!]
  assert.ok(at.withFloor > 800 && at.withFloor <= 870, String(at.withFloor))
  // after the exit, value is flat (all dollars)
  assert.equal(r.points[59].withFloor, r.points[r.exitedAt! + 1].withFloor)
})

test('deterministic and no exit when the drop is smaller than the floor', () => {
  assert.deepEqual(replay('balanced', 15, 40), replay('balanced', 15, 40))
  const r = replay('steady', 30, 10)
  assert.equal(r.exitedAt, undefined)
  assert.ok(Math.abs(r.points[0].withFloor - 1000) < 1)
})
