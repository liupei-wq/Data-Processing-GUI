import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'

interface Props {
  onFiles: (files: File[]) => void
  isLoading: boolean
  moduleLabel?: string
}

export default function FileUpload({ onFiles, isLoading, moduleLabel = 'XRD' }: Props) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) onFiles(accepted)
    },
    [onFiles],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/plain': ['.txt', '.asc', '.xy', '.dat'],
      'text/csv': ['.csv'],
    },
    disabled: isLoading,
  })

  return (
    <div
      {...getRootProps()}
      className={[
        'cursor-pointer rounded-[24px] border border-dashed p-5 text-center transition-all',
        isDragActive
          ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)] shadow-[var(--card-shadow-soft)]'
          : 'theme-block-soft border-[var(--input-border)] hover:border-[color:color-mix(in_srgb,var(--accent-strong)_42%,var(--input-border))] hover:bg-[var(--card-bg)]',
        isLoading ? 'cursor-not-allowed opacity-50' : '',
      ].join(' ')}
    >
      <input {...getInputProps()} />
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[20px] border border-[var(--pill-border)] bg-[var(--pill-bg)] text-2xl text-[var(--accent)] shadow-[var(--card-shadow-soft)]">
        ↑
      </div>
      {isDragActive ? (
        <p className="text-sm font-medium text-[var(--accent)]">放開以載入檔案</p>
      ) : (
        <>
          <div className="theme-pill inline-flex rounded-2xl px-4 py-2 text-base font-semibold text-[var(--text-main)]">
            Upload
          </div>
          <p className="mt-4 text-sm font-medium text-[var(--text-main)]">拖曳或點擊上傳 {moduleLabel} 檔案</p>
          <p className="mt-1 text-xs text-[var(--text-soft)]">500MB per file • TXT, CSV, XY, ASC, DAT</p>
        </>
      )}
    </div>
  )
}
