import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync } from "node:fs";

const pdf = await PDFDocument.create();
const page = pdf.addPage([595, 842]); // A4
const font = await pdf.embedFont(StandardFonts.Helvetica);
page.drawText("ACTA DE PRUEBA - FirmaDrive", {
  x: 60,
  y: 780,
  size: 18,
  font,
  color: rgb(0.1, 0.1, 0.1),
});
page.drawText("Este documento se usa para probar la firma digital.", {
  x: 60,
  y: 740,
  size: 12,
  font,
});
page.drawText("Firma aqui: ____________________", {
  x: 60,
  y: 120,
  size: 12,
  font,
});
const bytes = await pdf.save();
writeFileSync("certs/acta-prueba.pdf", bytes);
console.log("PDF de prueba: certs/acta-prueba.pdf (" + bytes.length + " bytes)");
