// KERNEL · 闹铃铃声库（本机文件 + 元数据索引）
// 纪律：音频文件只存 data/files/alarm-<id><ext>（data/ 已 gitignore）；
//       元数据只存 id / 显示名 / MIME / 字节数 / 内部文件名 / createdAt，不存本机绝对路径。
import { promises as fs } from 'node:fs'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { DATA_DIR } from './store.mjs'

const INDEX_FILE = path.join(DATA_DIR, 'meta', 'alarm-sounds.json')
const FILES_DIR = path.join(DATA_DIR, 'files')

function defaultIndex() {
  return { sounds: [] }
}

async function readIndex() {
  try {
    const parsed = JSON.parse(await fs.readFile(INDEX_FILE, 'utf8'))
    return Array.isArray(parsed?.sounds) ? parsed : defaultIndex()
  } catch {
    return defaultIndex()
  }
}

let writeChain = Promise.resolve()
function serialize(task) {
  const run = writeChain.then(task, task)
  writeChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function writeIndex(index) {
  await fs.mkdir(path.dirname(INDEX_FILE), { recursive: true })
  await writeFileAtomic(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, { encoding: 'utf8' })
}

export async function listAlarmSounds() {
  const index = await readIndex()
  return index.sounds
    .slice()
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
}

export async function getAlarmSound(id) {
  const index = await readIndex()
  return index.sounds.find((sound) => sound.id === id) ?? null
}

export async function nextAlarmSoundId() {
  const index = await readIndex()
  let max = 0
  for (const sound of index.sounds) {
    const match = /^as-(\d+)$/.exec(String(sound.id))
    if (match !== null) max = Math.max(max, Number(match[1]))
  }
  return `as-${String(max + 1).padStart(4, '0')}`
}

export function addAlarmSound(record) {
  return serialize(async () => {
    const index = await readIndex()
    index.sounds.push(record)
    await writeIndex(index)
    return record
  })
}

export async function removeAlarmSound(id) {
  return serialize(async () => {
    const index = await readIndex()
    const sound = index.sounds.find((item) => item.id === id)
    if (sound === undefined) return null
    index.sounds = index.sounds.filter((item) => item.id !== id)
    await writeIndex(index)
    if (typeof sound.fileName === 'string' && sound.fileName !== '') {
      await fs.unlink(path.join(FILES_DIR, sound.fileName)).catch(() => {})
    }
    return sound
  })
}

export function alarmFilePath(sound) {
  return path.join(FILES_DIR, sound.fileName)
}
