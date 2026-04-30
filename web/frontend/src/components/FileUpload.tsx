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

  const formatList = accept ?? ['.txt', '.csv', '.xy', '.asc', '.dat']

  return (
    <div
      {...getRootProps()}
      className={[
        'upload-zone group cursor-pointer p-5 text-center transition-all',
        isDragActive
          ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)] shadow-[var(--card-shadow-soft)]'
          : 'theme-block-soft border-[var(--input-border)] hover:border-[color:color-mix(in_srgb,var(--accent-strong)_42%,var(--input-border))] hover:bg-[var(--card-bg)]',
        isLoading ? 'cursor-not-allowed opacity-50' : '',
      ].join(' ')}
    >
      <input {...getInputProps()} />
      <svg viewBox="0 0 48 48" aria-hidden="true" className="upload-icon">
        <path d="M12 33.5h24a4.5 4.5 0 0 0 4.5-4.5V28a4.5 4.5 0 0 0-4.5-4.5H33" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15 23.5h-3A4.5 4.5 0 0 0 7.5 28v1a4.5 4.5 0 0 0 4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.78" />
        <path d="M24 31V12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M17.5 18.5 24 12l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {isDragActive ? (
        <p className="text-sm font-medium text-[var(--accent)]">放開以載入檔案</p>
      ) : (
        <>
          <div className="btn btn-primary inline-flex">選擇檔案</div>
          <p className="mt-1 text-sm font-medium text-[var(--text-main)]">拖曳或上傳 {moduleLabel} 檔案</p>
          <p className="upload-help">
            支援 {formatList.map(ext => ext.toUpperCase()).join(' / ')}
          </p>
        </>
      )}
    </div>
  )
}
