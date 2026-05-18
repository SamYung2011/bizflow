export const Input = ({ label, value, onChange, placeholder, type = "text", readOnly = false, suggest = null }) => {
  const sg = (suggest && value) ? suggest(value) : null
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 5 }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} readOnly={readOnly}
        style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", boxSizing: "border-box", background: readOnly ? "#fafbfc" : "#fff", color: readOnly ? "#888" : "#222" }} />
      {sg && (
        <div style={{ marginTop: 6, padding: "6px 10px", background: "#fef3c7", color: "#92400e", borderRadius: 8, fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <span>💡 是不是 <b>{sg}</b>？</span>
          <button type="button" onClick={() => onChange(sg)} style={{ marginLeft: "auto", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>修正</button>
        </div>
      )}
    </div>
  )
}

export const Select = ({ label, value, onChange, options }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ fontSize: 13, fontWeight: 700, color: "#555", display: "block", marginBottom: 5 }}>{label}</label>
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e0e0", fontSize: 14, outline: "none", background: "#fff" }}>
      <option value="">Select...</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
)
