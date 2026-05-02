export type WeakPeakIntensityTransform =
  | 'raw'
  | 'log10'
  | 'log1p'
  | 'sqrt'
  | 'normalized'

export type TransformedWeakPeakSeries = {
  x: number[]
  y: number[]
  label: string
  yAxisTitle: string
  description: string
}

function toFiniteNumber(value: unknown) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

function transformMeta(transform: WeakPeakIntensityTransform) {
  switch (transform) {
    case 'log10':
      return {
        label: 'log10 強度',
        yAxisTitle: 'log10 強度',
        description: '使用 log10(intensity - min + 1) 壓縮高強度峰，使弱峰更容易觀察。',
      }
    case 'log1p':
      return {
        label: 'log1p 強度',
        yAxisTitle: 'log1p 強度',
        description: '使用 log1p(intensity - min) 壓縮強度差異，適合含有低強度或零值的資料。',
      }
    case 'sqrt':
      return {
        label: '平方根強度',
        yAxisTitle: '平方根強度',
        description: '使用 sqrt(intensity - min) 壓縮強峰與弱峰差距，保留較直觀的強度變化。',
      }
    case 'normalized':
      return {
        label: '正規化強度',
        yAxisTitle: '相對強度（%）',
        description: '將 intensity 扣除最小值後正規化到 0-100，方便比較相對強度。',
      }
    case 'raw':
    default:
      return {
        label: '原始強度',
        yAxisTitle: '強度',
        description: '未轉換原始 intensity。',
      }
  }
}

export function transformWeakPeakIntensity(
  xInput: unknown[],
  yInput: unknown[],
  transform: WeakPeakIntensityTransform,
): TransformedWeakPeakSeries {
  const length = Math.min(xInput.length, yInput.length)
  const x: number[] = []
  const rawY: number[] = []

  for (let index = 0; index < length; index += 1) {
    const xValue = toFiniteNumber(xInput[index])
    const yValue = toFiniteNumber(yInput[index])
    if (xValue == null) continue
    x.push(xValue)
    rawY.push(yValue ?? 0)
  }

  const meta = transformMeta(transform)
  if (rawY.length === 0) return { x, y: [], ...meta }

  const minY = Math.min(...rawY)
  const shifted = rawY.map(value => Math.max(value - minY, 0))
  const maxShifted = Math.max(...shifted)

  const y = rawY.map((value, index) => {
    const shiftedValue = shifted[index] ?? 0
    if (transform === 'log10') return Math.log10(shiftedValue + 1)
    if (transform === 'log1p') return Math.log1p(shiftedValue)
    if (transform === 'sqrt') return Math.sqrt(shiftedValue)
    if (transform === 'normalized') return maxShifted > 0 ? (shiftedValue / maxShifted) * 100 : 0
    return Number.isFinite(value) ? value : 0
  })

  return { x, y, ...meta }
}

export function buildTransformedWeakPeakSeriesTxt(
  series: TransformedWeakPeakSeries,
  datasetName?: string | null,
  generatedAt = new Date(),
) {
  const lines = [
    'XRD 弱峰檢視轉換圖譜匯出',
    `產生時間：${generatedAt.toISOString()}`,
    `資料集：${datasetName || 'xrd'}`,
    `轉換方式：${series.label}`,
    `說明：${series.description}`,
    '',
    '欄位：',
    `序號\t2θ（度）\t${series.yAxisTitle}`,
    '',
  ]

  const length = Math.min(series.x.length, series.y.length)
  for (let index = 0; index < length; index += 1) {
    lines.push([
      index + 1,
      series.x[index]?.toFixed(4) ?? '',
      series.y[index]?.toFixed(6) ?? '',
    ].join('\t'))
  }

  return `${lines.join('\n')}\n`
}
