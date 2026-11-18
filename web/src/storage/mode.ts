export type StorageMode = 'local' | 'api'

let mode: StorageMode = 'local'

export const getStorageMode = () => mode
export const setStorageMode = (m: StorageMode) => {
  mode = m
}
