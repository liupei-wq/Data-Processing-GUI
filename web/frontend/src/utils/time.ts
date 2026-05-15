const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000

function shiftedUtc8Date(date: Date) {
  return new Date(date.getTime() + UTC8_OFFSET_MS)
}

export function formatUtc8Iso(date = new Date()) {
  return shiftedUtc8Date(date).toISOString().replace('Z', '+08:00')
}

export function timestampForUtc8Filename(date = new Date()) {
  const shifted = shiftedUtc8Date(date)
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    shifted.getUTCFullYear(),
    pad(shifted.getUTCMonth() + 1),
    pad(shifted.getUTCDate()),
    '_',
    pad(shifted.getUTCHours()),
    pad(shifted.getUTCMinutes()),
    pad(shifted.getUTCSeconds()),
  ].join('')
}
