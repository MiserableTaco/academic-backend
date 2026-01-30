import path from 'path';

export class PDFSecurityService {
  private static async loadPdfJs() {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return pdfjsLib;
  }

  static async validatePDF(buffer: Buffer, filename: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    const magic = buffer.subarray(0, 5).toString();
    if (magic !== '%PDF-') {
      errors.push('Invalid PDF file format (wrong magic number)');
      return { valid: false, errors };
    }

    if (buffer.length > 50 * 1024 * 1024) {
      errors.push('PDF file too large (max 50MB)');
      return { valid: false, errors };
    }

    try {
      const pdfjsLib = await this.loadPdfJs();
      
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
        verbosity: 0
      });

      const pdfDocument = await Promise.race([
        loadingTask.promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('PDF parse timeout')), 30000))
      ]);

      if (!pdfDocument || pdfDocument.numPages < 1) {
        throw new Error('Invalid PDF structure');
      }

      console.log(`✅ PDF validated: ${pdfDocument.numPages} pages`);
      await pdfDocument.destroy();
    } catch (error: any) {
      errors.push(`Failed to parse PDF: ${error.message}`);
      return { valid: false, errors };
    }

    const pdfContent = buffer.toString('binary');
    const forbiddenPatterns = ['/JavaScript', '/JS', '/AA', '/OpenAction', '/Launch', '/SubmitForm', '/ImportData'];

    for (const pattern of forbiddenPatterns) {
      if (pdfContent.includes(pattern)) {
        errors.push(`PDF contains forbidden action: ${pattern}`);
        return { valid: false, errors };
      }
    }

    return { valid: true, errors: [] };
  }

  static sanitizeFilename(filename: string): string {
    return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.+/g, '.').replace(/^\.+/, '').slice(0, 255);
  }
}
