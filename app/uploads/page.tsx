"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type UploadFile = {
  id: string;
  file: File;
  status: "pending" | "uploading" | "success" | "error";
  errorMessage?: string;
};

export default function UploadsPage() {
  const router = useRouter();
  const supabase = createClient();

  const [files, setFiles] = useState<UploadFile[]>([]);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_FILE_SIZE_MB = 10;
  const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

  useEffect(() => {
    async function initPage() {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        router.push("/login");
        return;
      }
      setUserEmail(data.user.email || "");
    }
    initPage();
  }, [router, supabase]);

  function formatSize(bytes: number) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function handleAddFiles(newFilesList: File[]) {
    const validFiles = newFilesList.filter(f => f.type.startsWith("image/") || f.type === "application/pdf");
    
    if (validFiles.length < newFilesList.length) {
      setMessage("Some files were ignored. Only images and PDFs are supported.");
      setStatus("error");
    } else {
      setMessage("");
      setStatus("idle");
    }

    const uploadFiles: UploadFile[] = validFiles.map(f => {
      if (f.size > MAX_FILE_SIZE_BYTES) {
        return {
          id: crypto.randomUUID(),
          file: f,
          status: "error",
          errorMessage: `File too large (max ${MAX_FILE_SIZE_MB}MB)`
        };
      }
      return {
        id: crypto.randomUUID(),
        file: f,
        status: "pending"
      };
    });

    setFiles(prev => [...prev, ...uploadFiles]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const filesToUpload = files.filter(f => f.status === "pending" || f.status === "error");
    
    if (files.length === 0) {
      setMessage("Please choose a file first.");
      setStatus("error");
      return;
    }
    
    if (filesToUpload.length === 0) {
      setMessage("All files are already uploaded or too large to upload.");
      setStatus("error");
      return;
    }

    setStatus("uploading");
    setMessage("");

    let successCount = 0;
    let failCount = 0;
    let lastId = null;

    const isBatch = filesToUpload.length > 1;

    for (let i = 0; i < filesToUpload.length; i++) {
      const f = filesToUpload[i];
      if (f.errorMessage && f.errorMessage.includes("too large")) {
        continue;
      }

      setMessage(`Uploading ${i + 1} of ${filesToUpload.length}...`);
      
      setFiles(prev => prev.map(pf => pf.id === f.id ? { ...pf, status: "uploading", errorMessage: undefined } : pf));

      const formData = new FormData();
      formData.append("file", f.file);
      formData.append("comment", comment);
      if (isBatch) {
        formData.append("is_queue", "true");
      }
      
      try {
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (res.ok) {
          successCount++;
          if (data.id) lastId = data.id;
          setFiles(prev => prev.map(pf => pf.id === f.id ? { ...pf, status: "success" } : pf));
        } else {
          failCount++;
          const errMsg = data?.message ? `${data.message}${data.step ? ` (${data.step})` : ""}` : "Upload failed";
          setFiles(prev => prev.map(pf => pf.id === f.id ? { ...pf, status: "error", errorMessage: errMsg } : pf));
        }
      } catch (err) {
        failCount++;
        const errMsg = err instanceof Error ? err.message : "Request failed";
        setFiles(prev => prev.map(pf => pf.id === f.id ? { ...pf, status: "error", errorMessage: errMsg } : pf));
      }
    }
    
    if (failCount > 0) {
      setStatus("error");
      setMessage(`Uploaded ${successCount} files. ${failCount} failed. Check the queue for details.`);
    } else {
      setStatus("done");
      setFiles([]);
      setComment("");
      if (filesToUpload.length === 1 && lastId) {
        router.push(`/inbox/${lastId}`);
      } else if (isBatch) {
        router.push("/review");
      } else {
        router.push("/inbox");
      }
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleAddFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const removeFile = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const retryFile = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setFiles(prev => prev.map(f => f.id === id ? { ...f, status: "pending", errorMessage: undefined } : f));
  };

  const inputClass = "w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] text-[var(--input-text)] px-3 py-3 placeholder:text-[var(--input-placeholder)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--border)]";
  const cardClass = "surface-panel p-4 shadow-sm";

  return (
    <main className="p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Upload Proof</h1>
            <p className="text-sm text-[var(--muted)] mt-0.5">Photo, screenshot, invoice, or handwritten note</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--muted)]">{userEmail}</span>
            <button type="button" onClick={handleLogout} className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--card-muted)] transition-colors">
              Logout
            </button>
          </div>
        </div>

        {/* Upload form */}
        <section className={cardClass}>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div 
              className={`rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                isDragging ? "border-[var(--primary)] dark:bg-teal-500/10 bg-teal-50" : "border-[var(--border)] bg-[var(--card-muted)] hover:bg-[var(--card-elevated)]"
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={handleKeyDown}
              role="button"
              tabIndex={0}
              aria-label="Upload file area"
            >
              <p className="text-base font-semibold text-[var(--foreground)] mb-1">Drag and drop your pictures here, or click to browse</p>
              <p className="text-xs text-[var(--muted)] mb-2">JPG, PNG, PDF, or any image format</p>
              <p className="text-xs font-medium text-[var(--primary)] dark:text-teal-400 bg-teal-50 dark:bg-teal-500/10 inline-block px-2 py-1 rounded mb-4">Tip: You can select or drag multiple files at once</p>
              <input
                type="file"
                multiple
                accept="image/*,.pdf"
                className="sr-only"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleAddFiles(Array.from(e.target.files));
                  }
                  // Reset input value to allow selecting the same file again if removed
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                ref={fileInputRef}
                onClick={(e) => e.stopPropagation()}
                tabIndex={-1}
              />
              {files.length > 0 && (
                <div className="mt-4 flex flex-col gap-2 items-center max-h-60 overflow-y-auto w-full px-2" onClick={(e) => e.stopPropagation()}>
                  {files.map((f) => (
                    <div key={f.id} className={`flex items-center justify-between gap-3 text-sm bg-[var(--card)] px-3 py-2 rounded-lg border shadow-sm w-full transition-colors ${
                      f.status === "error" ? "border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10" :
                      f.status === "success" ? "border-teal-300 dark:border-teal-500/30 bg-teal-50 dark:bg-teal-500/10" :
                      f.status === "uploading" ? "border-blue-300 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10" :
                      "border-[var(--border)]"
                    }`}>
                      <div className="flex flex-col text-left overflow-hidden w-full">
                        <div className="flex justify-between items-center w-full mb-0.5">
                          <span className="font-medium truncate text-[var(--foreground)]" title={f.file.name}>{f.file.name}</span>
                          <span className="text-[10px] font-semibold text-[var(--muted)] whitespace-nowrap ml-2">{formatSize(f.file.size)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${
                            f.status === "error" ? "text-red-600 dark:text-red-400" :
                            f.status === "success" ? "text-teal-600 dark:text-teal-400" :
                            f.status === "uploading" ? "text-blue-600 dark:text-blue-400" :
                            "text-[var(--muted)]"
                          }`}>
                            {f.status} {f.status === "error" && f.errorMessage ? `- ${f.errorMessage}` : ""}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center shrink-0">
                        {f.status === "error" && (
                          <button type="button" onClick={(e) => retryFile(f.id, e)} className="text-xs font-semibold text-[var(--foreground)] hover:text-[var(--primary)] px-2 py-1 bg-[var(--card-elevated)] border border-[var(--border)] hover:bg-[var(--card-muted)] rounded mr-2 shadow-sm transition-colors">
                            Retry
                          </button>
                        )}
                        {f.status !== "uploading" && f.status !== "success" && (
                          <button type="button" onClick={(e) => removeFile(f.id, e)} className="text-[var(--muted)] hover:text-red-500 dark:hover:text-red-400 font-bold px-2 py-1 bg-[var(--card-elevated)] border border-[var(--border)] hover:bg-red-50 dark:hover:bg-red-500/10 rounded shadow-sm transition-colors">✕</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-2">Add a note (optional)</label>
              <textarea
                className={`${inputClass} min-h-[100px]`}
                placeholder="Example: Payment to Rakesh for labour week 3"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="w-full btn-theme-accent py-3 px-4 rounded-lg disabled:opacity-60 transition-colors"
              disabled={status === "uploading" || files.length === 0}
            >
              {status === "uploading" ? "Uploading..." : "Upload proof →"}
            </button>

            {message && (
              <p className={`text-sm font-medium ${status === "error" ? "text-red-700 dark:text-red-400" : "text-[var(--foreground)]"}`}>
                {message}
              </p>
            )}
          </form>
        </section>

        {/* Action hint */}
        <div className="text-center">
          <p className="text-xs text-[var(--muted)]">
            Want to add a manual entry instead?{" "}
            <a href="/ledger" className="text-[var(--foreground)] underline hover:text-[var(--primary)] transition-colors">Go to Ledger</a>
          </p>
        </div>

      </div>
    </main>
  );
}
