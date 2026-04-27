import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import App from './App.jsx'
import { I18nProvider } from './i18n.jsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1 * 60 * 1000,    // 1 分鐘內資料新鮮，不 refetch（多人協作環境）
      gcTime: 24 * 60 * 60 * 1000, // 緩存保留 24h（包括持久化 TTL）
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'bizflow-cache',
  throttleTime: 1000,
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 24 * 60 * 60 * 1000,
        // 只持久化以 "bf" 開頭的 query（我們自己的業務資料）
        dehydrateOptions: {
          shouldDehydrateQuery: (q) => q.queryKey?.[0] === 'bf',
        },
      }}
    >
      <I18nProvider>
        <App />
      </I18nProvider>
    </PersistQueryClientProvider>
  </React.StrictMode>,
)
