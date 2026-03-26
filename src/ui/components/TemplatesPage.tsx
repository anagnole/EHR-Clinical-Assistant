import React, { useState, useEffect, useCallback } from "react";

interface Template {
  id: string;
  name: string;
  content: string;
}

interface Props {
  onBack: () => void;
  onUseTemplate: (template: Template) => void;
}

export function TemplatesPage({ onBack, onUseTemplate }: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [viewing, setViewing] = useState<Template | null>(null);

  const loadTemplates = useCallback(async () => {
    const res = await fetch("/api/templates");
    if (res.ok) setTemplates(await res.json());
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (!file.name.endsWith(".md") && !file.name.endsWith(".txt")) continue;
      const content = await file.text();
      await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, content }),
      });
    }
    loadTemplates();
  }, [loadTemplates]);

  const handleDelete = useCallback(async (id: string) => {
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    loadTemplates();
  }, [loadTemplates]);

  return (
    <div className="templates-page">
      <div className="templates-header">
        <h2>Document Templates</h2>
      </div>

      <div
        className={`templates-dropzone ${dragOver ? "drag-over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <div className="dropzone-content">
          <div className="dropzone-icon">+</div>
          <div className="dropzone-text">
            Drop .md or .txt template files here
          </div>
        </div>
      </div>

      <div className="templates-list">
        {templates.map((t) => (
          <div key={t.id} className="template-card">
            <div className="template-card-header">
              <span className="template-card-name">{t.name}</span>
              <div className="template-card-actions">
                <button
                  className="template-btn"
                  onClick={() => setViewing(viewing?.id === t.id ? null : t)}
                >
                  {viewing?.id === t.id ? "Hide" : "Preview"}
                </button>
                <button
                  className="template-btn template-btn-primary"
                  onClick={() => onUseTemplate(t)}
                >
                  Use
                </button>
                <button
                  className="template-btn template-btn-danger"
                  onClick={() => handleDelete(t.id)}
                >
                  Delete
                </button>
              </div>
            </div>
            {viewing?.id === t.id && (
              <pre className="template-preview">{t.content}</pre>
            )}
          </div>
        ))}
        {templates.length === 0 && (
          <div className="templates-empty">No templates yet. Drop a file above to add one.</div>
        )}
      </div>
    </div>
  );
}
