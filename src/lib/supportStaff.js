// Display-only directory for support ownership and historical message names.
// Authentication continues to use the current employee row in AppContext.
export async function listSupportStaff(client) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from('employees').select('id,email,name')
      .order('id', { ascending: true }).range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 1000) return rows;
  }
}
