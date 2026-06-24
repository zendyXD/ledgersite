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

  const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200";
  const cardClass = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900 p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Upload Proof</h1>
            <p className="text-sm text-slate-500 mt-0.5">Photo, screenshot, invoice, or handwritten note</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">{userEmail}</span>
            <button type="button" onClick={handleLogout} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100">
              Logout
            </button>
          </div>
        </div>

        {/* Upload form */}
        <section className={cardClass}>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div 
              className={`rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
                isDragging ? "border-teal-500 bg-teal-50" : "border-slate-300 bg-slate-50 hover:bg-slate-100"
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
              <p className="text-base font-semibold text-slate-900 mb-1">Drag and drop your pictures here, or click to browse</p>
              <p className="text-xs text-slate-500 mb-2">JPG, PNG, PDF, or any image format</p>
              <p className="text-xs font-medium text-teal-600 bg-teal-50 inline-block px-2 py-1 rounded mb-4">Tip: You can select or drag multiple files at once</p>
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
                    <div key={f.id} className={`flex items-center justify-between gap-3 text-sm bg-white px-3 py-2 rounded-lg border shadow-sm w-full transition-colors ${
                      f.status === "error" ? "border-red-300 bg-red-50" :
                      f.status === "success" ? "border-teal-300 bg-teal-50" :
                      f.status === "uploading" ? "border-blue-300 bg-blue-50" :
                      "border-slate-200"
                    }`}>
                      <div className="flex flex-col text-left overflow-hidden w-full">
                        <div className="flex justify-between items-center w-full mb-0.5">
                          <span className="font-medium truncate text-slate-800" title={f.file.name}>{f.file.name}</span>
                          <span className="text-[10px] font-semibold text-slate-500 whitespace-nowrap ml-2">{formatSize(f.file.size)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${
                            f.status === "error" ? "text-red-600" :
                            f.status === "success" ? "text-teal-600" :
                            f.status === "uploading" ? "text-blue-600" :
                            "text-slate-500"
                          }`}>
                            {f.status} {f.status === "error" && f.errorMessage ? `- ${f.errorMessage}` : ""}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center shrink-0">
                        {f.status === "error" && (
                          <button type="button" onClick={(e) => retryFile(f.id, e)} className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-2 py-1 bg-white border border-slate-200 hover:bg-slate-50 rounded mr-2 shadow-sm">
                            Retry
                          </button>
                        )}
                        {f.status !== "uploading" && f.status !== "success" && (
                          <button type="button" onClick={(e) => removeFile(f.id, e)} className="text-slate-400 hover:text-red-500 font-bold px-2 py-1 bg-white border border-slate-200 hover:bg-red-50 rounded shadow-sm">✕</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-800 mb-2">Add a note (optional)</label>
              <textarea
                className={`${inputClass} min-h-[100px]`}
                placeholder="Example: Payment to Rakesh for labour week 3"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-teal-700 px-4 py-3 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60 transition-colors"
              disabled={status === "uploading" || files.length === 0}
            >
              {status === "uploading" ? "Uploading..." : "Upload proof →"}
            </button>

            {message && (
              <p className={`text-sm font-medium ${status === "error" ? "text-red-700" : "text-slate-800"}`}>
                {message}
              </p>
            )}
          </form>
        </section>

        {/* Action hint */}
        <div className="text-center">
          <p className="text-xs text-slate-400">
            Want to add a manual entry instead?{" "}
            <a href="/ledger" className="text-slate-600 underline hover:text-slate-900">Go to Ledger</a>
          </p>
        </div>

      </div>
    </main>
  );
}
