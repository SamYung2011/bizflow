import { createContext, useContext, useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase, fetchAllTable } from '../lib/supabaseClient.js'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  // Provider 自己訂閱 auth 狀態以 gate useQuery；App.jsx 仍有自己的 session state，
  // 兩邊都訂閱 supabase.auth 同源事件流，會同步。後續 1c 把 session 也搬進來時統一。
  const [userId, setUserId] = useState(null)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id || null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setUserId(s?.user?.id || null)
    })
    return () => subscription?.unsubscribe?.()
  }, [])

  // 批 1：products / suppliers / warehouses / stocks
  const qProducts = useQuery({ queryKey: ['bf', 'products'], queryFn: () => fetchAllTable('products', 'name'), enabled: !!userId })
  const qWarehouses = useQuery({ queryKey: ['bf', 'warehouses'], queryFn: () => fetchAllTable('warehouses', 'sort_order'), enabled: !!userId })
  const qStocks = useQuery({ queryKey: ['bf', 'inventory_stock'], queryFn: () => fetchAllTable('inventory_stock', null), enabled: !!userId })
  const qSuppliers = useQuery({ queryKey: ['bf', 'suppliers'], queryFn: () => fetchAllTable('suppliers', 'created_at', false), enabled: !!userId })

  const [products, setProducts] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [stocks, setStocks] = useState([])
  const [suppliers, setSuppliers] = useState([])

  useEffect(() => { if (qProducts.data) setProducts(qProducts.data) }, [qProducts.data])
  useEffect(() => { if (qWarehouses.data) setWarehouses(qWarehouses.data) }, [qWarehouses.data])
  useEffect(() => { if (qStocks.data) setStocks(qStocks.data) }, [qStocks.data])
  useEffect(() => { if (qSuppliers.data) setSuppliers(qSuppliers.data) }, [qSuppliers.data])

  const value = {
    products, setProducts,
    warehouses, setWarehouses,
    stocks, setStocks,
    suppliers, setSuppliers,
    qProducts, qWarehouses, qStocks, qSuppliers,
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
