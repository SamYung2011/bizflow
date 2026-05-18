import { createContext, useContext } from 'react'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const value = {
    _phase: '1a',
  }
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useAppContext() {
  const ctx = useContext(AppContext)
  if (ctx === null) {
    throw new Error('useAppContext must be used inside <AppProvider>')
  }
  return ctx
}
