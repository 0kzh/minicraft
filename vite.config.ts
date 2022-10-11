import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  alias: {
    '~': resolve(__dirname, 'src'),
  },
  plugins: [react()]
})
