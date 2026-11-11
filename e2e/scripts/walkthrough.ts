// Records the captioned walkthrough and converts it to demo/nest-walkthrough.mp4 (fails if it is 3 minutes or longer).
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'

fs.rmSync('test-results', { recursive: true, force: true })
const run = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', 'tests/walkthrough.spec.ts'], { stdio: 'inherit' })
if (run.status !== 0) process.exit(run.status ?? 1)

const video = fs.readFileSync('test-results/walkthrough-video.txt', 'utf8').trim() // the app page's video, written by the spec
fs.mkdirSync('demo', { recursive: true })
const out = 'demo/nest-walkthrough.mp4'
const start = Math.max(0, Number(fs.readFileSync('test-results/walkthrough-start.txt', 'utf8')) - 0.5)
const end = Number(fs.readFileSync('test-results/walkthrough-end.txt', 'utf8'))
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', start.toFixed(2), '-to', end.toFixed(2), '-i', video, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out])
const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString())
console.log(`${out}: ${seconds.toFixed(1)}s, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`)
if (!(seconds < 180)) throw new Error(`walkthrough is ${seconds.toFixed(0)}s, must be under 180s`)
