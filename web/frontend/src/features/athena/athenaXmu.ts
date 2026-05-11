export interface AthenaScanResult {
  id: string
  fileName: string
  filePath: string
  sampleName: string
  e0: number | null
  edgeStep: number
  energy: number[]
  xmu: number[]
  bkg: number[]
  preEdge: number[]
  postEdge: number[]
  derivative: number[]
  secondDerivative: number[]
  i0: number[]
  chiE: number[]
  normalizedMu: number[]
  postEdgeNorm: number[]
  flattenedMu: number[]
  energyMinusE0: number[]
}

export interface AthenaAverageResult {
  id: string
  sampleName: string
  sourceScan1: string
  sourceScan2: string
  energy: number[]
  scan1NormalizedClean: number[]
  scan2NormalizedClean: number[]
  averageNormalized: number[]
  scan1FlattenedClean: number[]
  scan2FlattenedClean: number[]
  averageFlattened: number[]
  removedFromScan1Norm: number[]
  removedFromScan2Norm: number[]
  removedFromScan1Flat: number[]
  removedFromScan2Flat: number[]
}

export interface AthenaManualRemovalRegion {
  id: string
  start: number
  end: number
  scan: 'scan1' | 'scan2' | 'both'
}

export interface AthenaSampleGroup {
  sampleName: string
  scans: AthenaScanResult[]
  average: AthenaAverageResult | null
  warning?: string
}

export interface AthenaProcessResult {
  groups: AthenaSampleGroup[]
  scans: AthenaScanResult[]
  errors: string[]
}

type FileWithRelativePath = File & { webkitRelativePath?: string }

const SPIKE_DIFF_MAD_FACTOR = 4.5
const PEAK_EDGE_THRESHOLD_RATIO = 0.35
const MIN_PEAK_SEGMENT_POINTS = 1

function finiteNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readHeaderValue(headers: string[], key: string) {
  for (const header of headers) {
    if (!header.includes(key)) continue
    const matches = header.match(/[-+]?\d*\.\d+|[-+]?\d+/g)
    if (matches?.length) return Number(matches[matches.length - 1])
  }
  return null
}

function median(values: Array<number | null>) {
  const sorted = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function mad(values: number[]) {
  const center = median(values)
  if (center == null) return null
  return median(values.map(value => Math.abs(value - center)))
}

function interpolateNone(x: number[], y: Array<number | null>) {
  const output = y.slice()
  const validIndices = output
    .map((value, index) => (value == null ? -1 : index))
    .filter(index => index >= 0)

  if (validIndices.length === 0) throw new Error('整條曲線都是空值，無法內插。')

  const firstValid = validIndices[0]
  const lastValid = validIndices[validIndices.length - 1]

  for (let index = 0; index < firstValid; index += 1) output[index] = output[firstValid]
  for (let index = lastValid + 1; index < output.length; index += 1) output[index] = output[lastValid]

  let index = firstValid
  while (index <= lastValid) {
    if (output[index] != null) {
      index += 1
      continue
    }

    const left = index - 1
    let right = index
    while (right < output.length && output[right] == null) right += 1
    if (right >= output.length) break

    const xLeft = x[left]
    const xRight = x[right]
    const yLeft = output[left] ?? 0
    const yRight = output[right] ?? yLeft

    for (let fillIndex = left + 1; fillIndex < right; fillIndex += 1) {
      const ratio = xRight === xLeft ? 0 : (x[fillIndex] - xLeft) / (xRight - xLeft)
      output[fillIndex] = yLeft + ratio * (yRight - yLeft)
    }
    index = right
  }

  return output.map(value => value ?? 0)
}

function interpolateToGrid(xOld: number[], yOld: number[], xNew: number[]) {
  if (xOld.length < 2) throw new Error('資料點太少，無法內插。')

  const result: number[] = []
  let cursor = 0
  for (const x of xNew) {
    while (cursor < xOld.length - 2 && xOld[cursor + 1] < x) cursor += 1
    if (x <= xOld[0]) {
      result.push(yOld[0])
    } else if (x >= xOld[xOld.length - 1]) {
      result.push(yOld[yOld.length - 1])
    } else {
      const x1 = xOld[cursor]
      const x2 = xOld[cursor + 1]
      const y1 = yOld[cursor]
      const y2 = yOld[cursor + 1]
      const ratio = x2 === x1 ? 0 : (x - x1) / (x2 - x1)
      result.push(y1 + ratio * (y2 - y1))
    }
  }
  return result
}

function buildCommonEnergyGrid(results: AthenaScanResult[]) {
  const eMin = Math.max(...results.map(result => Math.min(...result.energy)))
  const eMax = Math.min(...results.map(result => Math.max(...result.energy)))
  const reference = results.reduce((best, result) => (result.energy.length > best.energy.length ? result : best), results[0])
  const grid = reference.energy.filter(energy => energy >= eMin && energy <= eMax)
  if (grid.length < 10) throw new Error('共同 energy grid 點數太少，無法平均。')
  return grid
}

function despikeTwoScans(x: number[], y1: number[], y2: number[]) {
  if (y1.length !== y2.length) throw new Error('兩筆 scan 長度不同，請先內插到共同 energy grid。')

  const diff = y1.map((value, index) => value - y2[index])
  const diffMed = median(diff) ?? 0
  const diffMad = mad(diff) || 1e-12
  const robustSigma = 1.4826 * diffMad
  const coreThreshold = SPIKE_DIFF_MAD_FACTOR * robustSigma
  const edgeThreshold = PEAK_EDGE_THRESHOLD_RATIO * coreThreshold
  const centeredDiff = diff.map(value => value - diffMed)
  const removedFrom1 = Array(y1.length).fill(0) as number[]
  const removedFrom2 = Array(y2.length).fill(0) as number[]
  const visited = Array(y1.length).fill(false) as boolean[]
  const segments: Array<{ start: number; end: number; sign: number }> = []

  for (let index = 0; index < centeredDiff.length; index += 1) {
    if (visited[index] || Math.abs(centeredDiff[index]) <= coreThreshold) continue

    const sign = centeredDiff[index] > 0 ? 1 : -1
    let start = index
    let end = index

    while (start > 0 && centeredDiff[start - 1] * sign > edgeThreshold) start -= 1
    while (end < centeredDiff.length - 1 && centeredDiff[end + 1] * sign > edgeThreshold) end += 1

    for (let visitIndex = start; visitIndex <= end; visitIndex += 1) visited[visitIndex] = true
    if (end - start + 1 >= MIN_PEAK_SEGMENT_POINTS) segments.push({ start, end, sign })
  }

  const merged: Array<{ start: number; end: number; sign: number }> = []
  for (const segment of segments) {
    const last = merged[merged.length - 1]
    if (last && last.sign === segment.sign && segment.start <= last.end + 1) {
      last.end = Math.max(last.end, segment.end)
    } else {
      merged.push({ ...segment })
    }
  }

  for (const segment of merged) {
    const signedArea = centeredDiff.slice(segment.start, segment.end + 1).reduce((sum, value) => sum + value, 0)
    if (signedArea > 0) {
      for (let index = segment.start; index <= segment.end; index += 1) removedFrom1[index] = 1
    } else if (signedArea < 0) {
      for (let index = segment.start; index <= segment.end; index += 1) removedFrom2[index] = 1
    }
  }

  return {
    y1Clean: interpolateNone(x, y1.map((value, index) => (removedFrom1[index] ? null : value))),
    y2Clean: interpolateNone(x, y2.map((value, index) => (removedFrom2[index] ? null : value))),
    removedFrom1,
    removedFrom2,
  }
}

function applyRemovalMasks(x: number[], y1: number[], y2: number[], removedFrom1: number[], removedFrom2: number[]) {
  return {
    y1Clean: interpolateNone(x, y1.map((value, index) => (removedFrom1[index] ? null : value))),
    y2Clean: interpolateNone(x, y2.map((value, index) => (removedFrom2[index] ? null : value))),
  }
}

function averageValues(y1: number[], y2: number[]) {
  return y1.map((value, index) => (value + y2[index]) / 2)
}

function applyManualRemovalRegions(
  energy: number[],
  removedFrom1: number[],
  removedFrom2: number[],
  manualRegions: AthenaManualRemovalRegion[] = [],
) {
  const nextRemovedFrom1 = removedFrom1.slice()
  const nextRemovedFrom2 = removedFrom2.slice()

  for (const region of manualRegions) {
    const start = Math.min(region.start, region.end)
    const end = Math.max(region.start, region.end)
    for (let index = 0; index < energy.length; index += 1) {
      if (energy[index] < start || energy[index] > end) continue
      if (region.scan === 'scan1' || region.scan === 'both') nextRemovedFrom1[index] = 1
      if (region.scan === 'scan2' || region.scan === 'both') nextRemovedFrom2[index] = 1
    }
  }

  return { removedFrom1: nextRemovedFrom1, removedFrom2: nextRemovedFrom2 }
}

function sampleNameFromFile(file: FileWithRelativePath) {
  const relativePath = file.webkitRelativePath || file.name
  const parts = relativePath.split('/').filter(Boolean)
  if (parts.length >= 2) return parts[parts.length - 2]
  return 'Root_Folder'
}

function filePathFromFile(file: FileWithRelativePath) {
  return file.webkitRelativePath || file.name
}

export function safeAthenaFilename(value: string) {
  return value.trim().replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').replace(/\s+/g, '_') || 'athena'
}

export function parseAthenaXmuText(text: string, fileName: string, filePath: string, sampleName: string): AthenaScanResult {
  const headers: string[] = []
  const rows: number[][] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      headers.push(line)
      continue
    }
    const row = line.split(/\s+/).map(finiteNumber)
    if (row.length >= 9 && row.every(value => value != null)) rows.push(row as number[])
  }

  if (rows.length === 0) throw new Error(`${fileName} 沒有讀到 9 欄格式的 Athena .xmu 數據。`)

  const e0 = readHeaderValue(headers, 'Athena.e0')
  const edgeStep = readHeaderValue(headers, 'Athena.edge_step')
  if (edgeStep == null) throw new Error(`${fileName} 找不到 Athena.edge_step。`)
  if (Math.abs(edgeStep) < 1e-30) throw new Error(`${fileName} 的 Athena.edge_step 為 0，無法正規化。`)

  const result: AthenaScanResult = {
    id: `${sampleName}:${filePath}`,
    fileName,
    filePath,
    sampleName,
    e0,
    edgeStep,
    energy: [],
    xmu: [],
    bkg: [],
    preEdge: [],
    postEdge: [],
    derivative: [],
    secondDerivative: [],
    i0: [],
    chiE: [],
    normalizedMu: [],
    postEdgeNorm: [],
    flattenedMu: [],
    energyMinusE0: [],
  }

  for (const row of rows) {
    const [energy, xmu, bkg, preEdge, postEdge, derivative, secondDerivative, i0, chiE] = row
    const normalizedMu = (xmu - preEdge) / edgeStep
    const postEdgeNorm = (postEdge - preEdge) / edgeStep
    result.energy.push(energy)
    result.xmu.push(xmu)
    result.bkg.push(bkg)
    result.preEdge.push(preEdge)
    result.postEdge.push(postEdge)
    result.derivative.push(derivative)
    result.secondDerivative.push(secondDerivative)
    result.i0.push(i0)
    result.chiE.push(chiE)
    result.normalizedMu.push(normalizedMu)
    result.postEdgeNorm.push(postEdgeNorm)
    result.flattenedMu.push(normalizedMu - postEdgeNorm + 1)
    result.energyMinusE0.push(e0 == null ? 0 : energy - e0)
  }

  return result
}

export function makeAthenaAverage(
  sampleName: string,
  scan1: AthenaScanResult,
  scan2: AthenaScanResult,
  manualRegions: AthenaManualRemovalRegion[] = [],
): AthenaAverageResult {
  const energy = buildCommonEnergyGrid([scan1, scan2])
  const norm1 = interpolateToGrid(scan1.energy, scan1.normalizedMu, energy)
  const norm2 = interpolateToGrid(scan2.energy, scan2.normalizedMu, energy)
  const normClean = despikeTwoScans(energy, norm1, norm2)
  const removalMask = applyManualRemovalRegions(energy, normClean.removedFrom1, normClean.removedFrom2, manualRegions)
  const normCleanWithManual = applyRemovalMasks(energy, norm1, norm2, removalMask.removedFrom1, removalMask.removedFrom2)
  const flat1 = interpolateToGrid(scan1.energy, scan1.flattenedMu, energy)
  const flat2 = interpolateToGrid(scan2.energy, scan2.flattenedMu, energy)
  const flatClean = applyRemovalMasks(energy, flat1, flat2, removalMask.removedFrom1, removalMask.removedFrom2)

  return {
    id: `${sampleName}:average`,
    sampleName: `${sampleName}_average`,
    sourceScan1: scan1.fileName,
    sourceScan2: scan2.fileName,
    energy,
    scan1NormalizedClean: normCleanWithManual.y1Clean,
    scan2NormalizedClean: normCleanWithManual.y2Clean,
    averageNormalized: averageValues(normCleanWithManual.y1Clean, normCleanWithManual.y2Clean),
    scan1FlattenedClean: flatClean.y1Clean,
    scan2FlattenedClean: flatClean.y2Clean,
    averageFlattened: averageValues(flatClean.y1Clean, flatClean.y2Clean),
    removedFromScan1Norm: removalMask.removedFrom1,
    removedFromScan2Norm: removalMask.removedFrom2,
    removedFromScan1Flat: removalMask.removedFrom1.slice(),
    removedFromScan2Flat: removalMask.removedFrom2.slice(),
  }
}

export async function processAthenaFiles(files: File[]): Promise<AthenaProcessResult> {
  const xmuFiles = files.filter(file => file.name.toLowerCase().endsWith('.xmu')) as FileWithRelativePath[]
  const groups = new Map<string, AthenaScanResult[]>()
  const scans: AthenaScanResult[] = []
  const errors: string[] = []

  for (const file of xmuFiles) {
    try {
      const sampleName = sampleNameFromFile(file)
      const filePath = filePathFromFile(file)
      const scan = parseAthenaXmuText(await file.text(), file.name, filePath, sampleName)
      scans.push(scan)
      groups.set(sampleName, [...(groups.get(sampleName) ?? []), scan])
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `${file.name} 解析失敗。`)
    }
  }

  const groupedResults = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sampleName, sampleScans]): AthenaSampleGroup => {
      const sortedScans = sampleScans.slice().sort((a, b) => a.fileName.localeCompare(b.fileName))
      if (sortedScans.length < 2) {
        return { sampleName, scans: sortedScans, average: null, warning: '此樣品少於兩筆 .xmu，略過平均。' }
      }
      try {
        const average = makeAthenaAverage(sampleName, sortedScans[0], sortedScans[1])
        const warning = sortedScans.length > 2 ? '此樣品超過兩筆 .xmu，目前使用排序後前兩筆做平均。' : undefined
        return { sampleName, scans: sortedScans, average, warning }
      } catch (error) {
        return {
          sampleName,
          scans: sortedScans,
          average: null,
          warning: error instanceof Error ? error.message : '平均處理失敗。',
        }
      }
    })

  return { groups: groupedResults, scans, errors }
}

function csvEscape(value: unknown) {
  if (value == null) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csvLine(values: unknown[]) {
  return values.map(csvEscape).join(',')
}

export function buildAthenaRawCsv(scan: AthenaScanResult) {
  const lines = [
    csvLine([
      'Energy',
      'xmu',
      'bkg',
      'pre_edge',
      'post_edge',
      'derivative',
      'second_derivative',
      'i0',
      'chi_e',
      'Normalized_mu',
      'Post_edge_norm',
      'Flattened_mu',
      'Energy_minus_E0',
    ]),
  ]
  for (let index = 0; index < scan.energy.length; index += 1) {
    lines.push(csvLine([
      scan.energy[index],
      scan.xmu[index],
      scan.bkg[index],
      scan.preEdge[index],
      scan.postEdge[index],
      scan.derivative[index],
      scan.secondDerivative[index],
      scan.i0[index],
      scan.chiE[index],
      scan.normalizedMu[index],
      scan.postEdgeNorm[index],
      scan.flattenedMu[index],
      scan.energyMinusE0[index],
    ]))
  }
  return `${lines.join('\n')}\n`
}

export function buildAthenaAverageCsv(average: AthenaAverageResult) {
  const lines = [
    csvLine([
      'Energy',
      'Scan1_Normalized_clean',
      'Scan2_Normalized_clean',
      'Average_Normalized',
      'Scan1_Flattened_clean',
      'Scan2_Flattened_clean',
      'Average_Flattened',
      'Removed_from_scan1_norm',
      'Removed_from_scan2_norm',
      'Removed_from_scan1_flat',
      'Removed_from_scan2_flat',
    ]),
  ]
  for (let index = 0; index < average.energy.length; index += 1) {
    lines.push(csvLine([
      average.energy[index],
      average.scan1NormalizedClean[index],
      average.scan2NormalizedClean[index],
      average.averageNormalized[index],
      average.scan1FlattenedClean[index],
      average.scan2FlattenedClean[index],
      average.averageFlattened[index],
      average.removedFromScan1Norm[index],
      average.removedFromScan2Norm[index],
      average.removedFromScan1Flat[index],
      average.removedFromScan2Flat[index],
    ]))
  }
  return `${lines.join('\n')}\n`
}

export function buildAthenaSummaryTxt(result: AthenaProcessResult) {
  const lines = [
    'Athena .xmu 資料夾處理摘要',
    `產生時間：${new Date().toISOString()}`,
    `樣品數：${result.groups.length}`,
    `有效 scan 數：${result.scans.length}`,
    '',
  ]

  for (const group of result.groups) {
    lines.push(`[${group.sampleName}]`)
    lines.push(`scan 數：${group.scans.length}`)
    if (group.warning) lines.push(`提醒：${group.warning}`)
    for (const scan of group.scans) {
      lines.push(`- ${scan.fileName} | E0=${scan.e0 ?? '-'} | edge_step=${scan.edgeStep} | points=${scan.energy.length}`)
    }
    if (group.average) {
      lines.push(`平均結果：${group.average.sampleName} | points=${group.average.energy.length}`)
      lines.push(`去尖峰點數：scan1=${group.average.removedFromScan1Norm.reduce((sum, value) => sum + value, 0)}, scan2=${group.average.removedFromScan2Norm.reduce((sum, value) => sum + value, 0)}`)
    }
    lines.push('')
  }

  if (result.errors.length) {
    lines.push('錯誤：')
    for (const error of result.errors) lines.push(`- ${error}`)
  }

  return `${lines.join('\n')}\n`
}

export function downloadTextFile(filename: string, content: string, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
