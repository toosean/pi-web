import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { isApiRequestAllowed } from "@/lib/request-security";
import { allowFileRoot } from "@/lib/file-access";
import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB per file
const MAX_REQUEST_SIZE = 200 * 1024 * 1024; // 200MB per batch

export async function POST(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  try {
    let formData: FormData;
    try {
      formData = await parseFormDataWithinLimit(request, MAX_REQUEST_SIZE);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return NextResponse.json({ error: "Upload payload too large (max 200MB)" }, { status: 413 });
      }
      throw error;
    }

    const files = [
      ...formData.getAll("files"),
      ...formData.getAll("file"),
    ].filter((entry): entry is File => typeof entry !== "string");

    if (files.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    const targetDir = os.tmpdir() || "/tmp";
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    allowFileRoot(targetDir);

    const savedFiles: Array<{ originalName: string; fileName: string; filePath: string; size: number }> = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: `File "${file.name}" exceeds 50MB limit` }, { status: 413 });
      }

      // Security: strip path traversal
      const rawName = path.basename(file.name || "uploaded_file");
      const ext = path.extname(rawName);
      const baseNameWithoutExt = path.basename(rawName, ext) || "file";

      let finalFileName = rawName;
      let targetPath = path.join(targetDir, finalFileName);

      // Handle collision in /tmp
      if (fs.existsSync(targetPath)) {
        const timestamp = Date.now();
        const shortId = Math.random().toString(36).substring(2, 6);
        finalFileName = `${baseNameWithoutExt}_${timestamp}_${shortId}${ext}`;
        targetPath = path.join(targetDir, finalFileName);
      }

      const bytes = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(targetPath, bytes);
      allowFileRoot(targetPath);

      savedFiles.push({
        originalName: file.name,
        fileName: finalFileName,
        filePath: targetPath,
        size: file.size,
      });
    }

    if (savedFiles.length === 1) {
      return NextResponse.json({
        success: true,
        originalName: savedFiles[0].originalName,
        fileName: savedFiles[0].fileName,
        filePath: savedFiles[0].filePath,
        size: savedFiles[0].size,
      });
    }

    return NextResponse.json({
      success: true,
      files: savedFiles,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
