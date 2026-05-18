// 小型 markdown 渲染組件 — 跟 bizflow 主端保持一致風格
// 用於更新日誌 / 評論 等 opt-in markdown 場景
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkBreaks from "remark-breaks"

export default function MarkdownText({ text, fontSize = 14 }) {
  if (!text) return null
  return (
    <div className="md" style={{ fontSize, lineHeight: 1.6 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" style={{ color: "#6382ff" }} />,
          code: ({ className, children, ...props }) => {
            const isBlock = /language-/.test(className || "")
            return isBlock
              ? <code {...props} className={className} style={{ fontFamily: "Menlo,Monaco,monospace", fontSize: "0.9em" }}>{children}</code>
              : <code {...props} style={{ background: "#f0f0f0", padding: "1px 5px", borderRadius: 4, fontSize: "0.9em", fontFamily: "Menlo,Monaco,monospace" }}>{children}</code>
          },
          pre: (props) => <pre {...props} style={{ background: "#f5f5f5", padding: 10, borderRadius: 6, overflow: "auto", margin: "8px 0" }} />,
          blockquote: (props) => <blockquote {...props} style={{ borderLeft: "3px solid #c6d3ff", margin: "8px 0", padding: "2px 10px", color: "#666" }} />,
          ul: (props) => <ul {...props} style={{ paddingLeft: 22, margin: "6px 0" }} />,
          ol: (props) => <ol {...props} style={{ paddingLeft: 22, margin: "6px 0" }} />,
          li: (props) => <li {...props} style={{ marginBottom: 2 }} />,
          h1: (props) => <h1 {...props} style={{ fontSize: "1.4em", margin: "8px 0", fontWeight: 800 }} />,
          h2: (props) => <h2 {...props} style={{ fontSize: "1.25em", margin: "8px 0", fontWeight: 800 }} />,
          h3: (props) => <h3 {...props} style={{ fontSize: "1.1em", margin: "6px 0", fontWeight: 700 }} />,
          table: (props) => <table {...props} style={{ borderCollapse: "collapse", margin: "8px 0" }} />,
          th: (props) => <th {...props} style={{ border: "1px solid #e0e0e0", padding: "4px 8px", background: "#fafbff", fontWeight: 700 }} />,
          td: (props) => <td {...props} style={{ border: "1px solid #e0e0e0", padding: "4px 8px" }} />,
        }}
      >{text}</ReactMarkdown>
    </div>
  )
}
