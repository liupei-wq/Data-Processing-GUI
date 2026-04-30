import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'

interface Props {
  onFiles: (files: File[]) => void
  isLoading?: boolean
  moduleLabel?: string
  accept?: string[]
}

export default function FileUpload({ onFiles, isLoading = false, moduleLabel = 'XRD', accept }: Props) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) onFiles(accepted)
    },
    [onFiles],
  )

  const acceptMap: Record<string, string[]> = accept
    ? { 'application/octet-stream': accept, 'text/plain': accept, 'text/csv': accept }
    : { 'text/plain': ['.txt', '.asc', '.xy', '.dat'], 'text/csv': ['.csv'] }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: acceptMap,
    disabled: isLoading,
  })

  return (
    <div
      {...getRootProps()}
      className={[
        'group cursor-pointer rounded-[18px] border border-dashed p-5 text-center transition-all',
        isDragActive
          ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)] shadow-[var(--card-shadow-soft)]'
          : 'theme-block-soft border-[var(--input-border)] hover:border-[color:color-mix(in_srgb,var(--accent-strong)_42%,var(--input-border))] hover:bg-[var(--card-bg)]',
        isLoading ? 'cursor-not-allowed opacity-50' : '',
      ].join(' ')}
    >
      <input {...getInputProps()} />
      <div className="upload-orbit-icon mx-auto mb-4">
        <span />
      </div>
      {isDragActive ? (
        <p className="text-sm font-medium text-[var(--accent)]">放開以載入檔案</p>
      ) : (
        <>
          <div className="theme-pill inline-flex rounded-2xl px-4 py-2 text-base font-semibold text-[var(--text-main)]">
            Upload
          </div>
          <p className="mt-4 text-sm font-medium text-[var(--text-main)]">拖曳或上傳 {moduleLabel} 檔案</p>
          <p className="mt-1 text-xs text-[var(--text-soft)]">
            {accept ? accept.map(e => e.toUpperCase().replace('.', '')).join(', ') : 'TXT, CSV, XY, ASC, DAT'}
          </p>
        </>
      )}
    </div>
  )
}
